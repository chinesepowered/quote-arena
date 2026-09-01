"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { bareAddress, caseCodeFromSubject } from "./lib/mailUtil";
import {
  AnswersSchema,
  HEURISTIC,
  heuristicAnalysis,
  heuristicAnswer,
  InboundAnalysisSchema,
  type InboundAnalysis,
  aiExtract,
} from "./lib/quoteAi";

/**
 * Runs (scheduled, off the webhook path) for every inbound email once it has
 * been stored and routed by mail.ingest. Turns a contractor's reply into:
 *   - a normalized quote row (superseding their earlier quote), and/or
 *   - question rows with a proposed answer (auto-sent when autoReply is on), or
 *   - a decline / auto-reply / other classification.
 *
 * The LLM does the classification and extraction; if it is slow or down, the
 * regex heuristics in lib/quoteAi.ts take over and the row is marked
 * aiState = "ai_unavailable" so the UI can say so honestly.
 */
export const onInbound = internalAction({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => {
    const mail = await ctx.runQuery(internal.messages.mailMessage, { mailMessageId });
    if (!mail || mail.direction !== "in") return;

    // Ignore our own outbound looping back (DEMO_RECIPIENT_OVERRIDE may point at this inbox).
    const settings = await ctx.runQuery(internal.messages.settings, {});
    if (settings && mail.from && bareAddress(mail.from) === settings.inboxAddress.toLowerCase()) {
      console.log("inbound: ignoring self-addressed message");
      return;
    }

    // Resolve the job: routed targetId first, then the [QA-xxxx] code in the subject.
    let job: (Doc<"jobs"> & { photos: { url: string }[] }) | null = null;
    if (mail.targetId) {
      try {
        job = await ctx.runQuery(internal.jobs.getInternal, { jobId: mail.targetId as Id<"jobs"> });
      } catch {
        job = null;
      }
    }
    if (!job) {
      const code = mail.caseCode ?? caseCodeFromSubject(mail.subject);
      if (code) {
        const byCode = await ctx.runQuery(internal.jobs.byCaseCode, { caseCode: code });
        if (byCode) {
          job = await ctx.runQuery(internal.jobs.getInternal, { jobId: byCode._id });
          await ctx.runMutation(internal.messages.routeMail, { mailMessageId, targetId: String(byCode._id), caseCode: code });
        }
      }
    }
    if (!job) {
      console.log("inbound: no job matched; left in the unrouted list");
      return;
    }

    // Which contractor? By thread, then by sender; otherwise create one from the sender.
    let contractor = await ctx.runQuery(internal.contractors.matchInbound, {
      jobId: job._id,
      threadId: mail.threadId,
      from: mail.from,
    });
    if (!contractor && mail.from) {
      const email = bareAddress(mail.from);
      const display = mail.from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
      const id = await ctx.runMutation(internal.contractors.createFromReply, {
        jobId: job._id,
        name: display || email.split("@")[0],
        email,
        threadId: mail.threadId,
      });
      contractor = await ctx.runQuery(internal.contractors.getInternal, { contractorId: id });
    }
    if (!contractor) return;
    if (mail.threadId && !contractor.sentThreadId) {
      await ctx.runMutation(internal.contractors.setThread, { contractorId: contractor._id, threadId: mail.threadId });
    }

    const text = (mail.extractedText || mail.fullText || "").trim();
    const messageId = await ctx.runMutation(internal.messages.record, {
      jobId: job._id,
      contractorId: contractor._id,
      mailMessageId,
      direction: "in",
      messageId: mail.messageId,
      threadId: mail.threadId,
      subject: mail.subject,
      extractedText: mail.extractedText ?? "",
      fullText: mail.fullText ?? "",
      aiState: "pending",
      at: mail.at,
    });

    // Classify + extract in one LLM call, with heuristic fallback.
    let analysis: InboundAnalysis;
    let model = HEURISTIC;
    let aiState = "ai_unavailable";
    {
      const res = await aiExtract(
        ctx,
        InboundAnalysisSchema,
        `A homeowner asked local contractors for quotes on this job:\n` +
          `Title: ${job.title}\nTrade: ${job.trade}\nLocation: ${job.city}, ${job.region}\nDetails: ${job.description}\nTiming: ${job.timing}\n\n` +
          `A contractor (${contractor.name}) replied with the email below. Classify it and extract the quote if there is a price. ` +
          `Use null for anything not stated — never guess numbers. Prices are numbers without symbols. ` +
          `If a single figure is given, set priceLow = priceHigh. List every question they asked.\n\n` +
          `Subject: ${mail.subject}\n\n${text.slice(0, 6000)}`,
        { system: "You are a careful assistant normalizing contractor emails into structured data.", maxTokens: 1200 },
      );
      if (res.ok) {
        analysis = res.data;
        model = res.model;
        aiState = "ok";
      } else {
        console.warn("inbound analysis fell back to heuristics:", res.error);
        analysis = heuristicAnalysis(text);
      }
    }

    await ctx.runMutation(internal.messages.classify, {
      messageId,
      classification: analysis.classification,
      summary: analysis.summary,
      aiState,
    });

    // Quote → leaderboard row (supersedes this contractor's earlier quote).
    if (analysis.quote && (analysis.quote.priceLow != null || analysis.quote.priceHigh != null)) {
      const q = analysis.quote;
      await ctx.runMutation(internal.quotes.insert, {
        jobId: job._id,
        contractorId: contractor._id,
        messageId,
        priceLow: q.priceLow ?? undefined,
        priceHigh: q.priceHigh ?? q.priceLow ?? undefined,
        currency: q.currency || "CAD",
        timelineDays: q.timelineDays ?? undefined,
        startEarliest: q.startEarliest ?? undefined,
        includes: q.includes ?? [],
        excludes: q.excludes ?? [],
        notes: q.notes ?? undefined,
        confidence: Math.max(0, Math.min(1, q.confidence ?? 0.5)),
        model,
      });
    } else if (analysis.classification === "decline") {
      await ctx.runMutation(internal.contractors.setRfq, { contractorId: contractor._id, rfqStatus: "declined", repliedAt: mail.at });
    } else if (analysis.classification !== "auto_reply") {
      await ctx.runMutation(internal.contractors.setRfq, { contractorId: contractor._id, rfqStatus: "replied", repliedAt: mail.at });
    }

    // Questions → proposed answers from the job facts only.
    const questions = (analysis.questions ?? []).filter((s) => s.trim().length > 3).slice(0, 5);
    if (questions.length) {
      let answers: { question: string; answer: string; grounded: boolean; model: string }[] | null = null;
      if (aiState === "ok") {
        {
          const res = await aiExtract(
            ctx,
            AnswersSchema,
            `Job facts (the ONLY source of truth):\nTitle: ${job.title}\nTrade: ${job.trade}\nLocation: ${job.city}, ${job.region}\n` +
              `Details: ${job.description}\nTiming: ${job.timing}\nBudget: ${job.budgetBand ?? "not shared"}\nPhotos: ${job.photos.length} attached to the original email.\n\n` +
              `Contractor ${contractor.name} asked these questions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n` +
              `Write a short, friendly answer to each, in the homeowner's voice, using only the job facts. ` +
              `If the facts do not answer a question, say you'll check and get back to them, and set grounded=false.`,
            { system: "Answer only from the job facts; if unknown, ask the homeowner. Never invent measurements or conditions.", maxTokens: 900 },
          );
          if (res.ok) answers = res.data.answers.map((a) => ({ ...a, model: res.model }));
          else console.warn("answer drafting skipped:", res.error);
        }
      }
      for (let i = 0; i < questions.length; i++) {
        const a = answers?.[i] ?? { ...heuristicAnswer(questions[i], job), question: questions[i], model: HEURISTIC };
        const questionId = await ctx.runMutation(internal.questions.create, {
          jobId: job._id,
          contractorId: contractor._id,
          messageId,
          question: questions[i],
          proposedAnswer: a.answer,
          grounded: a.grounded,
          model: a.model,
        });
        if (job.autoReply && a.grounded) {
          await ctx.scheduler.runAfter(0, internal.rfq.sendAnswer, { questionId });
        }
      }
    }
  },
});
