"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { startQuizAction, submitQuizAction } from "@/app/actions/learning";
import { Alert, Badge, Button, buttonClass, Card } from "@/components/ui";
import type { Locale } from "@/lib/i18n/config";
import { fmt, type Dictionary } from "@/lib/i18n/getDictionary";
import type { AnsweredQuiz, PublicQuiz } from "@/lib/quiz/store";

type Stage = "idle" | "loading" | "active" | "checking" | "done";

export function QuizRunner({ locale, labels, ruleNames }: { locale: Locale; labels: Dictionary["learn"]; ruleNames: Record<string, string> }) {
  const t = labels;
  const [stage, setStage] = useState<Stage>("idle");
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [result, setResult] = useState<AnsweredQuiz | null>(null);
  const [error, setError] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  async function start() {
    setError(false);
    setStage("loading");
    const res = await startQuizAction(locale);
    if (!res.ok) {
      setError(true);
      setStage("idle");
      return;
    }
    setQuiz(res.quiz);
    setChosen({});
    setResult(null);
    setStage("active");
  }

  async function submit() {
    if (!quiz) return;
    setError(false);
    setStage("checking");
    const res = await submitQuizAction(
      quiz.quiz_id,
      Object.entries(chosen).map(([question_id, chosen_index]) => ({ question_id, chosen_index })),
    );
    if (!res.ok) {
      setError(true);
      setStage("active");
      return;
    }
    setResult(res.result);
    setStage("done");
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    topRef.current?.focus();
  }

  const answered = quiz ? quiz.questions.filter((q) => chosen[q.id] !== undefined).length : 0;
  const total = quiz?.questions.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div ref={topRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {error && <Alert tone="danger">{t.quizError}</Alert>}
      </div>

      {(stage === "idle" || stage === "loading") && (
        <Button variant="primary" onClick={start} loading={stage === "loading"} loadingLabel={t.quizLoading} className="w-fit">
          {t.quizStart}
        </Button>
      )}

      {(stage === "active" || stage === "checking") && quiz && (
        <>
          {quiz.weak_rules.length > 0 && (
            <p className="text-text-muted">{fmt(t.quizFocus, { rules: quiz.weak_rules.map((r) => ruleNames[r] ?? r).join(", ") })}</p>
          )}
          <p className="font-mono text-sm font-bold uppercase" role="status">
            {fmt(t.quizAnswered, { n: answered, total })}
          </p>
          <ol className="flex list-none flex-col gap-6">
            {quiz.questions.map((q, i) => (
              <li key={q.id}>
                <Card as="div">
                  <fieldset className="flex flex-col gap-3" disabled={stage === "checking"}>
                    <legend className="mb-1">
                      <span className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-primary-ink">
                        {fmt(t.quizQuestion, { n: i + 1, total })} · {ruleNames[q.rule] ?? q.rule}
                      </span>
                      <span className="mt-1 block text-lg font-bold">{q.text}</span>
                    </legend>
                    {q.options.map((option, optionIndex) => (
                      <label
                        key={option}
                        className="flex min-h-11 cursor-pointer items-center gap-3 border-2 border-surface bg-canvas px-3 py-2 hover:bg-canvas-2 has-[:checked]:border-primary has-[:checked]:bg-[#eff8ff] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
                      >
                        <input
                          type="radio"
                          name={q.id}
                          value={optionIndex}
                          checked={chosen[q.id] === optionIndex}
                          onChange={() => setChosen((c) => ({ ...c, [q.id]: optionIndex }))}
                          className="size-5 accent-primary"
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </fieldset>
                </Card>
              </li>
            ))}
          </ol>
          {answered < total && <p className="text-text-muted">{fmt(t.quizUnanswered, { n: total - answered })}</p>}
          <Button variant="primary" onClick={submit} loading={stage === "checking"} loadingLabel={t.quizChecking} className="w-fit">
            {t.quizSubmit}
          </Button>
        </>
      )}

      {stage === "done" && quiz && result && (
        <>
          <Card className="flex flex-col gap-2">
            <p className="font-display text-5xl tabular-nums">{fmt(t.quizScore, { correct: result.correct, total: result.total })}</p>
          </Card>
          <ol className="flex list-none flex-col gap-4">
            {result.results.map((r, i) => {
              const q = quiz.questions.find((x) => x.id === r.question_id);
              if (!q) return null;
              return (
                <li key={r.question_id}>
                  <Card as="div" className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.correct ? "success" : "danger"}>{r.correct ? `✓ ${t.quizCorrect}` : `✕ ${t.quizWrong}`}</Badge>
                      <span className="font-mono text-xs font-bold uppercase text-text-muted">
                        {fmt(t.quizQuestion, { n: i + 1, total: result.total })} · {ruleNames[r.rule] ?? r.rule}
                      </span>
                    </div>
                    <p className="text-lg font-bold">{q.text}</p>
                    <p>
                      <span className="font-bold">{t.quizYourAnswer}: </span>
                      {r.chosen_index === null ? t.quizNoAnswer : q.options[r.chosen_index]}
                    </p>
                    {!r.correct && (
                      <p>
                        <span className="font-bold">{t.quizRightAnswer}: </span>
                        {q.options[r.correct_index]}
                      </p>
                    )}
                    <p className="text-text-muted">{r.explanation}</p>
                  </Card>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={start}>
              {t.quizRetry}
            </Button>
            <Link href={`/${locale}/profile`} className={buttonClass("secondary")}>
              {t.quizBack}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
