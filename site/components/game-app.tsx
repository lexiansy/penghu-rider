'use client';

import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  ExternalLink,
  LockKeyhole,
  MapPin,
  RotateCcw,
  ShieldCheck,
  SignalZero,
  Sparkles,
  Swords,
  Waves,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  bossScore,
  isClear,
  makeBossExam,
  makeDiagnostic,
  makeInitialProgress,
  makeRevengeSet,
  makeTargetedSet,
  recordAnswer,
  restoreProgress,
  serializeProgress,
  STORAGE_KEY,
  weakCategories,
} from '@/lib/game.mjs';

type Question = {
  id: string;
  sourceId: string;
  type: 'standard' | 'hazard' | 'scenario';
  category: string;
  subcategory: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  media: null | { kind: 'image'; src: string[] } | {
    kind: 'video-link';
    videoId: string;
    url: string;
    requiresNetwork: true;
  };
  tags: string[];
};

type Dataset = {
  meta: { counts: Record<string, number> };
  questions: Question[];
};

type SessionKind = 'diagnostic' | 'targeted' | 'boss' | 'revenge' | 'review' | 'monster';
type AppScreen = 'home' | 'session' | 'result' | 'monsters' | 'boss-intro';

type QuestionStat = { attempts: number; wrong: number; streak: number; mastery: 'learning' | 'monster' | 'defeated' };
type CategoryStat = { attempts: number; correct: number };
type GameSession = {
  kind: SessionKind;
  ids: string[];
  index: number;
  answers: Record<string, number>;
  startedAt: number | null;
};
type LastResult = {
  kind: SessionKind;
  correct: number;
  total: number;
  score?: number;
  cleared?: boolean;
};
type ProgressState = {
  version: number;
  activeDay: number;
  completedDays: number[];
  stats: Record<string, QuestionStat>;
  categoryStats: Record<string, CategoryStat>;
  session: GameSession | null;
  lastBossMisses: string[];
  bossRetryAvailable: boolean;
  clear: boolean;
  lastResult?: LastResult | null;
};

type WebModelContext = {
  registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

const missionSizes: Record<number, number> = { 1: 15, 2: 18, 3: 50 };
const ART_ROOT = '/art';

const stageArt: Record<number, { src: string; alt: string }> = {
  1: { src: `${ART_ROOT}/day1-lookout.webp`, alt: '海風偵察塔' },
  2: { src: `${ART_ROOT}/day2-lair.webp`, alt: '弱點怪物洞窟' },
  3: { src: `${ART_ROOT}/boss-roadkeeper.webp`, alt: '交通規則最終 Boss' },
};

function monsterArt(question: Question) {
  const subject = `${question.category} ${question.subcategory}`;
  if (question.type === 'hazard' || question.type === 'scenario') return `${ART_ROOT}/monster-hazard-perception.webp`;
  if (/大型車|內輪差|視野死角/.test(subject)) return `${ART_ROOT}/monster-large-vehicle.webp`;
  if (/事故/.test(subject)) return `${ART_ROOT}/monster-accident-response.webp`;
  if (/酒駕|手機|不當行為|危險駕駛/.test(subject)) return `${ART_ROOT}/monster-distracted-driving.webp`;
  if (/檢查|設備|燈光|裝載/.test(subject)) return `${ART_ROOT}/monster-vehicle-check.webp`;
  if (/路口|轉彎|迴轉|停讓/.test(subject)) return `${ART_ROOT}/monster-intersection.webp`;
  if (/車距|前車/.test(subject)) return `${ART_ROOT}/monster-following-distance.webp`;
  return `${ART_ROOT}/monster-bad-weather.webp`;
}

function monsterState(stat: QuestionStat) {
  if (stat.mastery === 'defeated') return { key: 'defeated', label: '已擊破', step: 4 };
  if (stat.streak === 1) return { key: 'weakened', label: '已削弱', step: 3 };
  if (stat.attempts > 1) return { key: 'active', label: '威脅中', step: 2 };
  return { key: 'discovered', label: '已發現', step: 1 };
}

function sessionLabel(kind: SessionKind) {
  return {
    diagnostic: '海風校準',
    targeted: '弱點追擊',
    boss: 'Boss Rush',
    revenge: '復仇回合',
    review: '自由複習',
    monster: '圖鑑再戰',
  }[kind];
}

export function GameApp() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [progress, setProgress] = useState<ProgressState>(() => {
    if (typeof window === 'undefined') return makeInitialProgress() as ProgressState;
    return restoreProgress(window.localStorage.getItem(STORAGE_KEY)) as ProgressState;
  });
  const [screen, setScreen] = useState<AppScreen>('home');
  const [selected, setSelected] = useState<number | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [timeLeft, setTimeLeft] = useState(30 * 60);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    fetch('/data/questions.json')
      .then((response) => {
        if (!response.ok) throw new Error('題庫載入失敗');
        return response.json();
      })
      .then((value: unknown) => setDataset(value as Dataset))
      .catch(() => setLoadError('題庫暫時無法載入，請重新整理。'));
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, serializeProgress(progress));
  }, [progress]);

  const questionMap = useMemo(
    () => new Map(dataset?.questions.map((question) => [question.id, question]) ?? []),
    [dataset],
  );
  const session = progress.session;
  const sessionQuestions: Question[] = session?.ids
    .map((id: string) => questionMap.get(id))
    .filter((question: Question | undefined): question is Question => Boolean(question)) ?? [];
  const currentQuestion = sessionQuestions[session?.index ?? 0];
  const storedAnswer = currentQuestion ? session?.answers?.[currentQuestion.id] : undefined;
  const answered = storedAnswer !== undefined;
  const immediate = session?.kind !== 'boss';
  let combo = 0;
  if (session && immediate) {
    for (let index = session.index; index >= 0; index -= 1) {
      const question = sessionQuestions[index];
      if (!question || session.answers[question.id] !== question.answerIndex) break;
      combo += 1;
    }
  }

  useEffect(() => {
    const startedAt = session?.startedAt;
    if (session?.kind !== 'boss' || !startedAt) return;
    const update = () => setTimeLeft(Math.max(0, 30 * 60 - Math.floor((Date.now() - startedAt) / 1000)));
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [session?.kind, session?.startedAt]);

  const startSession = useCallback((kind: SessionKind, explicit?: Question[]) => {
    if (!dataset) return;
    const seed = Date.now();
    let questions = explicit;
    if (!questions && kind === 'diagnostic') questions = makeDiagnostic(dataset.questions, seed);
    if (!questions && kind === 'targeted') questions = makeTargetedSet(dataset.questions, progress, 18, seed);
    if (!questions && kind === 'boss') questions = makeBossExam(dataset.questions, seed);
    if (!questions && kind === 'revenge') {
      questions = makeRevengeSet(dataset.questions, progress, progress.lastBossMisses, 10, seed);
    }
    if (!questions && kind === 'review') questions = makeTargetedSet(dataset.questions, progress, 10, seed);
    if (!questions) return;
    setProgress((current) => ({
      ...current,
      session: {
        kind,
        ids: questions.map((question) => question.id),
        index: 0,
        answers: {},
        startedAt: kind === 'boss' ? Date.now() : null,
      },
      lastResult: null,
    }));
    setSelected(null);
    setScreen('session');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [dataset, progress]);

  useEffect(() => {
    const context = (document as unknown as { modelContext?: WebModelContext }).modelContext;
    if (!dataset || !context?.registerTool) return;
    const lifecycle = new AbortController();
    const currentKind: SessionKind = progress.activeDay === 1
      ? 'diagnostic'
      : progress.activeDay === 2
        ? 'targeted'
        : 'boss';
    try {
      void Promise.resolve(context.registerTool({
        name: 'start_study_session',
        title: '開始澎湖騎士練習',
        description: '開始目前三日旅程任務，或開始一輪10題自由複習；畫面會切換到同一個答題流程。',
        inputSchema: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['current', 'review'] } },
          required: ['mode'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input: unknown) {
          const mode = (input as { mode?: string })?.mode;
          if (mode !== 'current' && mode !== 'review') throw new Error('mode 必須是 current 或 review');
          if (mode === 'current' && progress.session) {
            setScreen('session');
            return { status: 'resumed', kind: progress.session.kind };
          }
          const kind = mode === 'review' ? 'review' : currentKind;
          startSession(kind);
          return { status: 'started', kind };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch {
      return;
    }
    return () => lifecycle.abort();
  }, [dataset, progress.activeDay, progress.session, startSession]);

  const completeLearningSession = (nextProgress: ProgressState) => {
    const activeSession = nextProgress.session;
    if (!activeSession) return;
    const kind = activeSession.kind;
    const answers = activeSession.answers;
    const correct = sessionQuestions.filter((question) => answers[question.id] === question.answerIndex).length;
    const result = { kind, correct, total: sessionQuestions.length };
    const completedDays = [...nextProgress.completedDays];
    let activeDay = nextProgress.activeDay;
    let bossRetryAvailable = nextProgress.bossRetryAvailable;
    if (kind === 'diagnostic') {
      if (!completedDays.includes(1)) completedDays.push(1);
      activeDay = 2;
    }
    if (kind === 'targeted') {
      if (!completedDays.includes(2)) completedDays.push(2);
      activeDay = 3;
    }
    if (kind === 'revenge') bossRetryAvailable = true;
    setProgress({
      ...nextProgress,
      activeDay,
      completedDays,
      bossRetryAvailable,
      session: null,
      lastResult: result,
    });
    setScreen('result');
  };

  const completeBoss = (answers: Record<string, number>) => {
    if (!dataset) return;
    let next = { ...progress };
    const misses: string[] = [];
    let correct = 0;
    for (const question of sessionQuestions) {
      const right = answers[question.id] === question.answerIndex;
      if (right) correct += 1;
      else misses.push(question.id);
      next = recordAnswer(next, question, right) as ProgressState;
    }
    const score = bossScore(correct);
    const cleared = isClear(score);
    const completedDays = [...next.completedDays];
    if (cleared && !completedDays.includes(3)) completedDays.push(3);
    setProgress({
      ...next,
      activeDay: 3,
      completedDays,
      session: null,
      lastBossMisses: misses,
      bossRetryAvailable: false,
      clear: cleared,
      lastResult: { kind: 'boss', correct, total: 50, score, cleared },
    });
    setScreen('result');
  };

  const chooseAnswer = (optionIndex: number) => {
    if (!currentQuestion || answered) return;
    setSelected(optionIndex);
    if (!immediate) return;
    setProgress((current) => {
      let next = recordAnswer(current, currentQuestion, optionIndex === currentQuestion.answerIndex) as ProgressState;
      if (!next.session) return current;
      const activeSession = next.session;
      next = {
        ...next,
        session: {
          ...activeSession,
          answers: { ...activeSession.answers, [currentQuestion.id]: optionIndex },
        },
      };
      return next;
    });
  };

  const advance = () => {
    if (!session || !currentQuestion || selected === null) return;
    const isLast = session.index === sessionQuestions.length - 1;
    if (session.kind === 'boss') {
      const answers = { ...session.answers, [currentQuestion.id]: selected };
      if (isLast) return completeBoss(answers);
      setSelected(null);
      setProgress((current) => current.session ? ({
        ...current,
        session: { ...current.session, answers, index: current.session.index + 1 },
      }) : current);
      return;
    }
    if (isLast) return completeLearningSession(progress);
    setSelected(null);
    setProgress((current) => current.session ? ({
      ...current,
      session: { ...current.session, index: current.session.index + 1 },
    }) : current);
  };

  const continueCurrent = () => {
    if (!progress.session) return;
    setScreen('session');
  };

  const resetJourney = () => {
    setProgress(makeInitialProgress());
    setScreen('home');
  };

  if (loadError) {
    return <main className="center-state"><SignalZero /><h1>海面訊號不穩</h1><p>{loadError}</p></main>;
  }
  if (!dataset) {
    return <main className="center-state"><Waves className="loading-wave" /><h1>題庫靠岸中</h1><p>正在整理今日遭遇…</p></main>;
  }

  if (screen === 'session' && session && currentQuestion) {
    const correct = answered && storedAnswer === currentQuestion.answerIndex;
    const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const seconds = (timeLeft % 60).toString().padStart(2, '0');
    return (
      <main className={`app-shell session-shell ${session.kind === 'boss' ? 'is-boss-session' : ''}`}>
        <section className="game-panel">
          <header className="session-header">
            <Button className="icon-action" variant="ghost" onClick={() => setScreen('home')} aria-label="返回首頁">
              <ArrowLeft />
            </Button>
            <div>
              <small>{sessionLabel(session.kind)}</small>
              <strong>{session.index + 1} / {sessionQuestions.length}</strong>
            </div>
            {session.kind === 'boss' ? (
              <span className="timer"><Clock3 /> {minutes}:{seconds}</span>
            ) : combo >= 2 ? <span className="combo-pill"><Sparkles /> COMBO {combo}</span> : <span className="mode-pill">遭遇！</span>}
          </header>

          <div className="journey-hud" aria-label={`旅程進度 ${session.index + 1} / ${sessionQuestions.length}`}>
            <div className="hud-route" aria-hidden="true">
              <span className="hud-route-fill" style={{ width: `${((session.index + 1) / sessionQuestions.length) * 100}%` }} />
              <Image
                className="hud-scooter"
                src={`${ART_ROOT}/player-scooter-hono.webp`}
                alt=""
                width={320}
                height={300}
                style={{ left: `calc(${((session.index + 1) / sessionQuestions.length) * 100}% - 20px)` }}
                unoptimized
              />
            </div>
            <span className="hud-encounters">剩 {sessionQuestions.length - session.index} 遭遇</span>
          </div>

          <article className="question-card">
            <div className="question-meta">
              <span>{currentQuestion.category}</span>
              <span>{currentQuestion.type === 'hazard' ? '影片題' : currentQuestion.type === 'scenario' ? '情境題' : `第 ${currentQuestion.sourceId} 題`}</span>
            </div>

            {currentQuestion.media?.kind === 'image' && (
              <div className={`question-images ${currentQuestion.media.src.length > 1 ? 'image-grid' : ''}`}>
                {currentQuestion.media.src.map((src) => (
                  <Image src={src} alt="官方題目圖示" width={1200} height={900} unoptimized key={src} />
                ))}
              </div>
            )}

            {currentQuestion.media?.kind === 'video-link' && (
              <div className={`video-card ${online ? '' : 'is-offline'}`}>
                <div>
                  <small>官方危險感知影片 {currentQuestion.media.videoId}</small>
                  <strong>{online ? '觀看影片後作答' : '影片需網路連線'}</strong>
                </div>
                {online ? (
                  <a href={currentQuestion.media.url} target="_blank" rel="noreferrer">
                    開啟影片 <ExternalLink />
                  </a>
                ) : <SignalZero aria-hidden="true" />}
              </div>
            )}

            {currentQuestion.prompt && <h1 className="question-title">{currentQuestion.prompt}</h1>}

            <fieldset className="options" aria-label="選擇答案">
              {currentQuestion.options.map((option, index) => {
                const isChosen = (answered ? storedAnswer : selected) === index;
                const revealRight = immediate && answered && index === currentQuestion.answerIndex;
                const revealWrong = immediate && answered && isChosen && !correct;
                return (
                  <button
                    className={`option ${isChosen ? 'is-chosen' : ''} ${revealRight ? 'is-right' : ''} ${revealWrong ? 'is-wrong' : ''}`}
                    disabled={answered}
                    key={`${currentQuestion.id}-${index}`}
                    onClick={() => chooseAnswer(index)}
                    type="button"
                  >
                    <span className="option-number">{index + 1}</span>
                    <span>{option}</span>
                    {revealRight && <Check aria-hidden="true" />}
                    {revealWrong && <X aria-hidden="true" />}
                  </button>
                );
              })}
            </fieldset>

            {immediate && answered && (
              <output className={`feedback ${correct ? 'is-correct' : 'is-incorrect'}`}>
                <span className="feedback-art" aria-hidden="true">
                  {correct ? <Sparkles /> : <Image src={monsterArt(currentQuestion)} alt="" width={192} height={192} unoptimized />}
                </span>
                <span className="feedback-copy">
                  <strong>{correct ? (progress.stats[currentQuestion.id]?.mastery === 'defeated' ? '復仇成功' : combo >= 2 ? `${combo} 連擊！` : '答對了') : '新怪物收進圖鑑'}</strong>
                  <span>{correct ? '這次的道路判斷很穩。' : `記住牠的弱點：正確答案是 ${currentQuestion.answerIndex + 1}。`}</span>
                </span>
              </output>
            )}

            <div className="question-action">
              <Button
                className="primary-action"
                disabled={selected === null && !answered}
                onClick={advance}
              >
                {session.index === sessionQuestions.length - 1 ? (session.kind === 'boss' ? '交卷' : '完成任務') : '下一題'}
                <ChevronRight />
              </Button>
            </div>
          </article>
          <p className="question-source-note">題目依交通部公路局目前公開題庫整理</p>
        </section>
      </main>
    );
  }

  if (screen === 'boss-intro') {
    return (
      <main className="app-shell boss-intro-shell">
        <section className="game-panel boss-intro-panel">
          <Button className="icon-action boss-back" variant="ghost" onClick={() => setScreen('home')} aria-label="返回旅程地圖">
            <ArrowLeft />
          </Button>
          <div className="boss-atmosphere" aria-hidden="true">
            <span className="boss-lane boss-lane-one" />
            <span className="boss-lane boss-lane-two" />
          </div>
          <Image className="boss-hero" src={`${ART_ROOT}/boss-roadkeeper.webp`} alt="由交通號誌、標線與警告設施組成的最終 Boss" width={420} height={420} priority unoptimized />
          <p className="boss-kicker"><Swords /> FINAL ISLAND</p>
          <h1>規則守門者</h1>
          <p className="boss-copy">號誌、標線與道路規則聚成最後一關。進場後回到正式、安靜的答題畫面。</p>
          <div className="boss-rules" aria-label="Boss Rush 題型組成">
            <span><strong>50</strong> 題</span>
            <span><strong>30</strong> 分鐘</span>
            <span><strong>90</strong> 分 CLEAR</span>
          </div>
          <p className="boss-mix">10 影片 · 5 情境 · 35 一般題</p>
          <Button className="primary-action boss-action" onClick={() => startSession('boss')}>
            騎上最終島 <ChevronRight />
          </Button>
        </section>
      </main>
    );
  }

  if (screen === 'monsters') {
    const monsters = dataset.questions
      .filter((question) => progress.stats[question.id]?.wrong > 0)
      .sort((a, b) => progress.stats[b.id].wrong - progress.stats[a.id].wrong);
    return (
      <main className="app-shell">
        <section className="game-panel">
          <header className="subpage-header">
            <Button className="icon-action" variant="ghost" onClick={() => setScreen('home')} aria-label="返回首頁"><ArrowLeft /></Button>
            <div><p className="eyebrow">MONSTER BOOK</p><h1>錯題圖鑑</h1></div>
          </header>
          <div className="bestiary-legend" aria-label="怪物熟練度階段">
            <span>已發現</span><span>威脅中</span><span>已削弱</span><span>已擊破</span>
          </div>
          {monsters.length === 0 ? (
            <div className="empty-card bestiary-empty">
              <Image src={`${ART_ROOT}/monster-hazard-perception.webp`} alt="危險感知怪物剪影" width={192} height={192} unoptimized />
              <h2>圖鑑還是一片空白</h2><p>答錯的題目會化成怪物留在這裡，直到連續答對兩次。</p>
            </div>
          ) : (
            <>
              <div className="monster-list">
                {monsters.map((question) => {
                  const stat = progress.stats[question.id];
                  const state = monsterState(stat);
                  return (
                    <article className={`monster-item is-${state.key}`} key={question.id}>
                      <div className="monster-portrait">
                        <Image src={monsterArt(question)} alt={`${question.subcategory}怪物`} width={192} height={192} unoptimized />
                        {state.key === 'defeated' && <span className="defeated-seal" aria-label="已擊破"><ShieldCheck /></span>}
                      </div>
                      <div className="monster-entry">
                        <div className="monster-heading"><small>{question.subcategory}</small><span className={`threat-pill is-${state.key}`}>{state.label}</span></div>
                        <strong>{question.prompt || `圖像題 ${question.sourceId}`}</strong>
                        <span>遭遇 {stat.attempts} · 失手 {stat.wrong} · 連勝 {stat.streak}</span>
                        <div className="mastery-track" aria-label={`熟練度：${state.label}`}>
                          {[1, 2, 3, 4].map((step) => <i className={step <= state.step ? 'is-lit' : ''} key={step} />)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <Button className="primary-action" onClick={() => startSession('monster', monsters.slice(0, 12))}>
                圖鑑再戰 <ChevronRight />
              </Button>
            </>
          )}
        </section>
      </main>
    );
  }

  if (screen === 'result' && progress.lastResult) {
    const result = progress.lastResult;
    const weak = weakCategories(progress).slice(0, 3);
    const isBoss = result.kind === 'boss';
    return (
      <main className="app-shell result-shell">
        <section className="game-panel">
          <article className={`result-card ${result.cleared ? 'is-clear' : ''}`}>
            {result.cleared ? (
              <div className="clear-art-wrap">
                <Image src={`${ART_ROOT}/clear-coast.webp`} alt="騎士與 Hono 抵達澎湖旅程終點" width={960} height={640} priority unoptimized />
                <span className="clear-stamp"><Sparkles /> ROUTE COMPLETE</span>
              </div>
            ) : (
              <Image
                className="result-landmark"
                src={isBoss ? stageArt[3].src : result.kind === 'diagnostic' ? stageArt[1].src : stageArt[2].src}
                alt={isBoss ? stageArt[3].alt : result.kind === 'diagnostic' ? stageArt[1].alt : stageArt[2].alt}
                width={300}
                height={260}
                unoptimized
              />
            )}
            <p className="eyebrow">{sessionLabel(result.kind)}</p>
            <h1>{result.cleared ? '筆試篇 CLEAR' : isBoss ? `${result.score} 分` : `${result.correct} / ${result.total}`}</h1>
            <p>{result.cleared ? '澎湖地圖解鎖準備中' : isBoss ? '先用短回合追回失分，不必立刻再跑 50 題。' : '路線已重新校準，下一站會集中追擊弱點。'}</p>

            {!result.cleared && weak.length > 0 && (
              <div className="weak-list">
                <small>目前較弱區域</small>
                {weak.map((item: { name: string; accuracy: number }) => (
                  <div key={item.name}><span>{item.name}</span><strong>{Math.round(item.accuracy * 100)}%</strong></div>
                ))}
              </div>
            )}

            {result.kind === 'diagnostic' && (
              <Button className="primary-action" onClick={() => startSession('targeted')}>進入 DAY 2 <ChevronRight /></Button>
            )}
            {result.kind === 'targeted' && (
              <Button className="primary-action" onClick={() => setScreen('home')}>回到旅程 <ChevronRight /></Button>
            )}
            {result.kind === 'boss' && !result.cleared && (
              <Button className="primary-action revenge-action" onClick={() => startSession('revenge')}>開始復仇回合 <RotateCcw /></Button>
            )}
            {result.kind === 'revenge' && (
              <Button className="primary-action" onClick={() => startSession('boss')}>再次挑戰 Boss <ChevronRight /></Button>
            )}
            {(result.kind === 'review' || result.kind === 'monster' || result.cleared) && (
              <Button className="primary-action" onClick={() => setScreen('home')}>回到旅程 <ChevronRight /></Button>
            )}
          </article>
        </section>
      </main>
    );
  }

  const activeDay = progress.clear ? 3 : progress.activeDay;
  const activeSession = progress.session;
  const hasSession = Boolean(activeSession);
  const mission = activeDay === 1
    ? { title: '先確認你的道路直覺', copy: '一輪精簡診斷，找出接下來兩天最值得追的弱點。', kind: 'diagnostic' as const }
    : activeDay === 2
      ? { title: '追擊最容易失手的路段', copy: '錯題、低正確率與數字規則會優先出現。', kind: 'targeted' as const }
      : { title: progress.bossRetryAvailable ? 'Boss 已可再次挑戰' : '50 題 Boss Rush', copy: '10 題影片、5 題情境、35 題一般題；90 分才算 CLEAR。', kind: 'boss' as const };
  const remaining = activeSession ? activeSession.ids.length - activeSession.index : missionSizes[activeDay];
  const launchMission = () => {
    if (hasSession) return continueCurrent();
    if (activeDay === 3) {
      setScreen('boss-intro');
      window.scrollTo({ top: 0 });
      return;
    }
    startSession(mission.kind);
  };

  return (
    <main className="app-shell home-shell">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <section className="home-card" aria-labelledby="app-title">
        <header className="brand-row">
          <Image className="brand-mark brand-icon" src={`${ART_ROOT}/app-icon-192.png`} alt="" width={192} height={192} priority unoptimized />
          <div className="brand-copy">
            <p className="eyebrow">3-DAY LICENSE RUSH</p>
            <h1 id="app-title">澎湖騎士</h1>
            <p className="brand-subtitle">三日公路冒險</p>
          </div>
          <span className="brand-stage"><small>JOURNEY</small><strong>DAY {activeDay}</strong></span>
        </header>

        <div className="home-scroll-region">
          <section className="adventure-map" aria-label="三日澎湖冒險地圖">
          <Image className="map-art" src={`${ART_ROOT}/adventure-map.webp`} alt="連接海風偵察、弱點洞窟與最終島嶼的澎湖路線" width={720} height={1560} priority unoptimized />
          {[
            ['DAY 1', '海風校準'],
            ['DAY 2', '弱點追擊'],
            ['DAY 3', 'Boss Rush'],
          ].map(([day, label], index) => {
            const number = index + 1;
            const complete = progress.completedDays.includes(number);
            const current = number === activeDay && !progress.clear;
            const locked = number > activeDay && !progress.clear;
            return (
              <div className={`map-stop stop-${number} ${current ? 'is-current' : ''} ${complete ? 'is-complete' : ''} ${locked ? 'is-locked' : ''}`} key={day}>
                <span className="map-stop-pin">{complete ? <Check /> : locked ? <LockKeyhole /> : <MapPin />}</span>
                <span className="map-stop-copy"><small>{day}</small><strong>{label}</strong><em>{complete ? '已探索' : current ? '目前位置' : '尚未解鎖'}</em></span>
              </div>
            );
          })}

          <Image
            className={`map-player token-day-${activeDay} ${progress.clear ? 'is-clear' : ''}`}
            src={`${ART_ROOT}/player-scooter-hono.webp`}
            alt="騎士與 Hono 的目前位置"
            width={320}
            height={300}
            priority
            unoptimized
          />
          <div className="map-caption"><span className="map-pulse" /> 目前旅程 · DAY {activeDay}</div>
          </section>

          <article className="mission-card map-mission-card">
          <div className="mission-summary">
            <div>
              <div className="mission-kicker"><Compass /><span>目前任務</span></div>
              <h2>{progress.clear ? '筆試篇 CLEAR' : mission.title}</h2>
              <p>{progress.clear ? '澎湖地圖解鎖準備中' : mission.copy}</p>
            </div>
            <Image className="mission-landmark" src={stageArt[activeDay].src} alt={stageArt[activeDay].alt} width={300} height={260} unoptimized />
          </div>
          {!progress.clear && (
            <>
              <div className="encounter-row"><span>今日剩餘遭遇</span><strong>{remaining}</strong></div>
              <Button className="primary-action" onClick={launchMission}>
                {hasSession ? '繼續' : activeDay === 3 ? '挑戰 Boss' : '開始'} <ChevronRight />
              </Button>
            </>
          )}
          </article>

          <section className="home-actions" aria-label="旅程捷徑">
          <button className="secondary-action" onClick={() => setScreen('monsters')} type="button">
            <span className="secondary-icon"><BookOpen /></span>
            <span><strong>錯題圖鑑</strong><small>{Object.values(progress.stats).filter((stat) => stat.wrong > 0 && stat.mastery !== 'defeated').length || '還沒有'} 隻待復仇</small></span>
            <ChevronRight />
          </button>

          {Object.keys(progress.stats).length > 0 && (
            <button className="secondary-action review-card-action" onClick={() => startSession('review')} type="button">
              <span className="secondary-icon review-icon"><RotateCcw /></span>
              <span><strong>自由複習</strong><small>隨機重跑 10 題，保持手感</small></span>
              <ChevronRight />
            </button>
          )}
          </section>

          <footer className="brand-footer">
            <div className="fox-signature">
              <span className="fox-glow" aria-hidden="true" />
              <Image src={`${ART_ROOT}/lex-yao-fox-logo-512.png`} alt="Lexian 與 Yao 的藍光狐狸標誌" width={512} height={512} unoptimized />
              <span>✦ Created together by Lexian &amp; Yao ✦</span>
            </div>
            <button className="reset-action" onClick={resetJourney} type="button">重設本機進度</button>
          </footer>
        </div>
      </section>
    </main>
  );
}
