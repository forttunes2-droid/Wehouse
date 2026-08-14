import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type Question = { id: string; question: string; options: string[] };
type StartResult = {
  already_passed?: boolean;
  passed?: boolean;
  score?: number;
  total?: number;
  percent?: number;
  pass_percent?: number;
  attempt_id?: string;
  questions?: Question[];
  expires_at?: string;
};
type SubmitResult = {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  pass_percent?: number;
};

type Props = {
  onPassed: () => void | Promise<void>;
};

export default function WorkerReadinessTest({ onPassed }: Props) {
  const [loading, setLoading] = useState(false);
  const [attemptId, setAttemptId] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const answered = useMemo(() => Object.keys(answers).length, [answers]);

  async function start() {
    setLoading(true);
    const { data, error } = await supabase.rpc('start_my_worker_test');
    setLoading(false);
    if (error) return toast.error(error.message);
    const payload = (data || {}) as StartResult;
    if (payload.already_passed || payload.passed) {
      toast.success('Worker readiness test already passed');
      await onPassed();
      return;
    }
    setAttemptId(payload.attempt_id || '');
    setQuestions(Array.isArray(payload.questions) ? payload.questions : []);
    setExpiresAt(payload.expires_at || null);
    setAnswers({});
    setResult(null);
  }

  async function submit() {
    if (!attemptId) return;
    if (answered !== questions.length) return toast.error('Answer every question before submitting');
    setLoading(true);
    const { data, error } = await supabase.rpc('submit_my_worker_test', {
      p_attempt_id: attemptId,
      p_answers: answers,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const payload = data as SubmitResult;
    setResult(payload);
    if (payload.passed) {
      toast.success(`Test passed · ${payload.percent}%`);
      await onPassed();
    } else {
      toast.error(`You scored ${payload.percent}%. You need ${payload.pass_percent || 80}% to pass.`);
    }
  }

  if (result) {
    return (
      <section className={`rounded-3xl border p-5 ${result.passed ? 'border-emerald-500/20 bg-emerald-500/[.05]' : 'border-amber-500/20 bg-amber-500/[.05]'}`}>
        <p className={`text-[10px] font-bold uppercase tracking-[.18em] ${result.passed ? 'text-emerald-300' : 'text-amber-300'}`}>WORKER READINESS TEST</p>
        <p className="mt-3 text-3xl font-bold">{result.percent}%</p>
        <p className="mt-2 text-xs leading-relaxed text-[#858B9B]">
          {result.passed
            ? 'Passed. Your next step is professional evidence.'
            : `You need ${result.pass_percent || 80}% to pass. Review the questions and try again.`}
        </p>
        {!result.passed && (
          <button onClick={() => void start()} disabled={loading} className="mt-4 rounded-xl bg-cyan-500 px-4 py-3 text-xs font-semibold text-[#041014] disabled:opacity-50">
            {loading ? 'Preparing…' : 'Try again'}
          </button>
        )}
      </section>
    );
  }

  if (!attemptId) {
    return (
      <section className="rounded-3xl border border-cyan-500/15 bg-[#10151D] p-5">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300">WORKER READINESS TEST</p>
        <h2 className="mt-3 text-xl font-bold">Prove you understand safe, professional work</h2>
        <p className="mt-2 text-xs leading-relaxed text-[#777E8F]">
          The test checks customer safety, privacy, honest job conduct and WeHouse rules. It is scored by the server; the answers are never sent to the browser.
        </p>
        <div className="mt-4 rounded-2xl border border-white/[.06] bg-black/10 p-4 text-[10px] leading-relaxed text-[#858B99]">
          8 questions · 80% pass mark · 45 minute attempt · limited retries per day
        </div>
        <button onClick={() => void start()} disabled={loading} className="mt-4 h-12 w-full rounded-2xl bg-cyan-500 text-xs font-semibold text-[#041014] disabled:opacity-50">
          {loading ? 'Preparing test…' : 'Start Worker test'}
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-cyan-500/15 bg-[#10151D] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-300">WORKER READINESS TEST</p>
            <h2 className="mt-2 text-xl font-bold">{answered}/{questions.length} answered</h2>
          </div>
          {expiresAt && <span className="rounded-full border border-white/[.07] px-2.5 py-1 text-[9px] text-[#7D8494]">45 min attempt</span>}
        </div>
      </div>

      {questions.map((question, index) => (
        <article key={question.id} className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4 sm:p-5">
          <p className="text-[9px] font-semibold text-[#5F6777]">QUESTION {index + 1}</p>
          <h3 className="mt-2 text-sm font-semibold leading-relaxed">{question.question}</h3>
          <div className="mt-4 space-y-2">
            {question.options.map((option, optionIndex) => {
              const selected = answers[question.id] === optionIndex;
              return (
                <button
                  key={`${question.id}-${optionIndex}`}
                  onClick={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left text-xs leading-relaxed ${selected ? 'border-cyan-500/35 bg-cyan-500/[.08] text-cyan-100' : 'border-white/[.07] bg-black/10 text-[#A8ADBA]'}`}
                >
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] ${selected ? 'border-cyan-400 bg-cyan-500 text-[#041014]' : 'border-white/15'}`}>
                    {selected ? '✓' : String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        </article>
      ))}

      <button onClick={() => void submit()} disabled={loading || answered !== questions.length} className="h-12 w-full rounded-2xl bg-cyan-500 text-xs font-semibold text-[#041014] disabled:opacity-40">
        {loading ? 'Scoring…' : 'Submit test'}
      </button>
    </section>
  );
}
