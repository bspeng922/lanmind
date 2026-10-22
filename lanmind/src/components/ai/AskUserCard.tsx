import React, { useId, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { tr, useLocale } from '../../i18n';
import { aiError } from './aiClient';
import { AssistantMarkdown } from './AssistantMarkdown';
import { formatAskUserAnswer, type AskUserRequest } from './askUser';
import './ask-user.css';

interface Props {
  request: AskUserRequest;
  answer?: string;
  onAnswer?: (answer: string) => Promise<void>;
  disabled?: boolean;
}

function QuestionText({ value }: { value: string }) {
  if (/(?:^|\n) {0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,}|\|)/.test(value)) {
    return <AssistantMarkdown value={value} />;
  }
  const paragraphs = value.split(/\n\s*\n/);
  return <div className="ai-question-text">{paragraphs.map((paragraph, index) => {
    const newline = paragraph.indexOf('\n');
    const hasTitle = paragraphs.length > 2 && index > 0 && newline > 0 && newline < 90 && !/^[#>*\-\d`]/.test(paragraph);
    return <div key={index} className={hasTitle ? 'ai-question-text-section' : undefined}>
      {hasTitle ? <>
        <AssistantMarkdown value={paragraph.slice(0, newline)} className="font-semibold" />
        <AssistantMarkdown value={paragraph.slice(newline + 1)} />
      </> : <AssistantMarkdown value={paragraph} />}
    </div>;
  })}</div>;
}

export const AskUserCard: React.FC<Props> = ({ request, answer = '', onAnswer, disabled = false }) => {
  useLocale();
  const id = useId();
  const [selections, setSelections] = useState<number[][]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const interactive = !!onAnswer && !answer;
  const locked = disabled || busy || submitted;
  const formatted = formatAskUserAnswer(request, selections, text);
  const completed = request.questions.filter((_, index) => selections[index]?.length).length;

  const submit = async () => {
    if (!onAnswer || locked || sending.current || !formatted) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await onAnswer(formatted);
      setSubmitted(true);
    } catch (error) {
      setError(aiError(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const questions = <>
    {request.question && <QuestionText value={request.question} />}
    {request.questions.map((group, index) => <fieldset className="ai-question-group" key={index} disabled={!interactive || locked}>
      <legend>
        <span className="ai-question-number">{index + 1}</span>
        <span className="ai-question-group-title">{group.question}</span>
        <span className="ai-question-mode">{tr(group.multiple ? 'ai:ask.multiple' : 'ai:ask.single')}</span>
      </legend>
      <div className="ai-question-options">{group.options.map((option, optionIndex) => {
        const selected = selections[index]?.includes(optionIndex) ?? false;
        const optionId = `${id}-${index}-${optionIndex}`;
        return <label className="ai-question-option" data-selected={selected} key={optionIndex}>
          <input
            type={group.multiple ? 'checkbox' : 'radio'}
            name={`${id}-${index}`}
            checked={selected}
            aria-labelledby={`${optionId}-label`}
            aria-describedby={option.description ? `${optionId}-description` : undefined}
            onChange={() => setSelections((previous) => {
              const next = [...previous];
              const current = previous[index] ?? [];
              next[index] = group.multiple ? (current.includes(optionIndex) ? current.filter((value) => value !== optionIndex) : [...current, optionIndex]) : [optionIndex];
              return next;
            })}
          />
          <span className="ai-question-option-copy">
            <span id={`${optionId}-label`} className="ai-question-option-title">{option.label}</span>
            {option.description && <span id={`${optionId}-description`} className="ai-question-option-description">{option.description}</span>}
          </span>
        </label>;
      })}</div>
    </fieldset>)}
  </>;

  return <section className="ai-question-card" aria-label={tr('ai:ask.title')} data-state={answer ? 'answered' : interactive ? 'waiting' : 'inactive'}>
    <header className="ai-question-header">
      <span className="ai-question-icon">{answer ? <Check size={16} /> : <MessageCircleQuestion size={16} />}</span>
      <strong>{tr('ai:ask.title')}</strong>
      <span className="ai-question-status">{tr(answer ? 'ai:ask.answered' : interactive ? 'ai:ask.waiting' : 'ai:ask.question')}</span>
    </header>
    <div className="ai-question-body">
      {answer ? <>
        <details className="ai-question-history"><summary>{tr('ai:ask.viewQuestion')}<ChevronDown size={13} /></summary><div>{questions}</div></details>
        <div className="ai-question-answer"><span>{tr('ai:ask.yourAnswer')}</span><p>{answer}</p></div>
      </> : questions}
      {interactive && <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="ai-question-form">
        <label htmlFor={`${id}-answer`}>{tr(request.questions.length ? 'ai:ask.additional' : 'ai:v2.answer')}</label>
        <textarea
          id={`${id}-answer`}
          className="ai-v2-input"
          rows={3}
          placeholder={tr(request.questions.length ? 'ai:ask.additionalPlaceholder' : 'ai:ask.answerPlaceholder')}
          value={text}
          disabled={locked}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault(); void submit();
            }
          }}
        />
        {error && <p role="alert" className="ai-v2-error">{error}</p>}
        <div className="ai-question-footer">
          <span>{request.questions.length ? tr('ai:ask.progress', { count: completed, total: request.questions.length }) : tr('ai:ask.shortcut')}</span>
          <button type="submit" className="ai-v2-btn primary" disabled={locked || !formatted}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : submitted ? <Check size={13} /> : <Send size={13} />}
            {tr(busy ? 'ai:ask.submitting' : submitted ? 'ai:ask.submitted' : 'ai:v2.submitAnswer')}
          </button>
        </div>
      </form>}
    </div>
  </section>;
};
