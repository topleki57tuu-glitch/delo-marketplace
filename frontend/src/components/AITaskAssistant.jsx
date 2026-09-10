import React, { useState } from 'react';
import axios from 'axios';
import { useToast } from './Toast';

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const EXAMPLE_PROMPTS = [
    "Починить стиральную машину Samsung, течет вода снизу, Москва, ул. Тверская 10",
    "Сделать современный сайт-визитку для юридической компании, удалённо",
    "Генеральная уборка 2-комнатной квартиры после ремонта в Казани",
    "Заменить замок во входной двери в Санкт-Петербурге, срочно"
];

export const AITaskAssistant = ({ onApplyTask, onCancel }) => {
    const toast = useToast();
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    const handleParse = async (customPrompt) => {
        const textToUse = customPrompt || prompt;
        if (!textToUse.trim()) {
            toast.error('Введите описание задачи');
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post(`${API_URL}/ai/parse-task`, { prompt: textToUse });
            setResult(res.data);
            toast.success('Задание успешно обработано AI!');
            
            // Если есть Telegram Haptic Feedback, вызываем легкую вибрацию успеха
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        } catch (err) {
            console.error(err);
            toast.error(err.response?.data?.detail || 'Ошибка AI-помощника. Попробуйте еще раз.');
        } finally {
            setLoading(false);
        }
    };

    const handleApply = () => {
        if (!result) return;
        onApplyTask(result);
        if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
        }
    };

    return (
        <div className="bg-surface-2 border border-accent/40 rounded-2xl p-5 shadow-glow-sm relative overflow-hidden">
            {/* Background glowing gradient */}
            <div className="absolute -top-12 -right-12 w-36 h-36 bg-accent/20 rounded-full blur-2xl pointer-events-none" />
            
            <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-lg">
                        ✨
                    </span>
                    <div>
                        <h4 className="font-display font-bold uppercase text-sm text-ink flex items-center gap-2">
                            AI-Помощник создания заказа
                            <span className="bg-gradient-to-r from-accent to-[#38BDF8] text-white text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full">
                                Быстро
                            </span>
                        </h4>
                        <p className="text-xs text-muted">
                            Опишите задачу одной фразой — AI сформирует ТЗ и подскажет рыночную цену
                        </p>
                    </div>
                </div>
            </div>

            <div className="mt-3">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Например: Нужно поменять смеситель в ванной и починить сифон под раковиной в Казани, бюджет около 2500..."
                    rows={3}
                    className="w-full rounded-xl border border-border bg-surface text-ink placeholder-muted/60 p-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/40"
                />

                {/* Example prompt pills */}
                <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Примеры:</span>
                    {EXAMPLE_PROMPTS.map((ex, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={() => {
                                setPrompt(ex);
                                handleParse(ex);
                            }}
                            className="rounded-lg bg-surface border border-border/80 px-2.5 py-1 text-[11px] text-muted hover:text-ink hover:border-accent/50 transition truncate max-w-[280px]"
                            title={ex}
                        >
                            {ex}
                        </button>
                    ))}
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                    <button
                        type="button"
                        onClick={() => handleParse()}
                        disabled={loading || !prompt.trim()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-[#38BDF8] text-white px-5 py-2.5 font-display text-xs uppercase tracking-wider transition hover:glow-accent-sm active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                    >
                        {loading ? (
                            <>
                                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                                Анализирую...
                            </>
                        ) : (
                            <>✨ Разобрать с AI</>
                        )}
                    </button>

                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="text-xs text-muted hover:text-ink transition"
                        >
                            Заполнить вручную
                        </button>
                    )}
                </div>
            </div>

            {/* AI Result Card */}
            {result && (
                <div className="mt-5 pt-5 border-t border-border/80 animate-fadeIn">
                    <div className="rounded-xl bg-surface border border-accent/30 p-4">
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-accent bg-accent/10 px-2 py-0.5 rounded-md">
                                Результат анализа
                            </span>
                            <span className="text-xs font-bold text-ink">
                                💰 Рекомендуемый бюджет: <span className="text-accent">{result.recommended_budget} ₽</span>
                            </span>
                        </div>

                        <div className="font-display font-bold text-base text-ink mb-1">
                            {result.title}
                        </div>

                        <div className="text-xs text-muted flex items-center gap-3 flex-wrap mb-3">
                            <span>📂 Категория: <b>{result.category}</b></span>
                            {result.is_remote ? (
                                <span>🌐 Удалённо</span>
                            ) : (
                                <span>📍 {result.city || 'Город не указан'}</span>
                            )}
                        </div>

                        <div className="bg-surface-2 rounded-lg p-3 text-xs text-muted mb-3 whitespace-pre-line border border-border/50">
                            {result.description}
                        </div>

                        <div className="p-2.5 rounded-lg bg-accent/5 border border-accent/20 text-[11px] text-muted mb-4">
                            💡 {result.explanation}
                        </div>

                        <button
                            type="button"
                            onClick={handleApply}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent text-white px-5 py-2.5 font-display text-xs uppercase tracking-wider transition hover:bg-accent-bright hover:glow-accent-sm active:scale-[0.98]"
                        >
                            ✅ Использовать эти данные в заказе
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
