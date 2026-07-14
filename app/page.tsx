'use client';

import { useState } from 'react';
import { useTokenStatsContext } from './context/TokenStatsContext';
import { TokenStats } from './components/TokenStats';

interface Link {
  text: string;
  url: string;
}

interface Step {
  id: string;
  title: string;
  description: string;
  actions: string[];
  links: Link[];
  cost: number;
  isCompleted: boolean;
}

interface TravelPlan {
  title?: string;
  totalBudget?: number;
  steps?: Step[];
  tips?: string[];
}

export default function Home() {
  const { addTokenUsage } = useTokenStatsContext();

  const [formData, setFormData] = useState({
    departureCity: '',
    destination: 'Вьетнам',
    date: '',
    budget: '',
  });

  const [loading, setLoading] = useState(false);
  const [travelPlan, setTravelPlan] = useState<TravelPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [usedRag, setUsedRag] = useState<boolean | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setTravelPlan(null);
    setUsedRag(null);

    try {
      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate travel plan');
      }

      const data = await response.json();

      // Extract token usage information if available
      if (data._tokenUsage && data._model) {
        addTokenUsage(
          data._model,
          data._tokenUsage.inputTokens,
          data._tokenUsage.outputTokens,
          'generate-travel-plan',
          false
        );
        setLastModel(data._model);
      }

      // Remove token usage data from the response before setting travel plan
      const { _tokenUsage, _model, _usedRag, ...travelPlanData } = data;
      setUsedRag(typeof _usedRag === 'boolean' ? _usedRag : false);
      setTravelPlan(travelPlanData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const toggleStepCompletion = (stepId: string) => {
    const newCompletedIds = new Set(completedIds);
    if (newCompletedIds.has(stepId)) {
      newCompletedIds.delete(stepId);
    } else {
      newCompletedIds.add(stepId);
    }
    setCompletedIds(newCompletedIds);
  };

  const handleQuestionClick = (stepId: string) => {
    // Placeholder for question functionality
    alert('Функция "У меня вопрос" будет добавлена позже');
  };

  const getCompletedCount = () => {
    if (!travelPlan?.steps) return 0;
    return travelPlan.steps.filter(step => completedIds.has(step.id)).length;
  };

  const getTotalSteps = () => {
    return travelPlan?.steps?.length || 0;
  };

  const getProgressPercentage = () => {
    const total = getTotalSteps();
    if (total === 0) return 0;
    return Math.round((getCompletedCount() / total) * 100);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-2 text-gray-800 dark:text-white">
            🌴 Планировщик путешествий
          </h1>
          <p className="text-center text-gray-600 dark:text-gray-300 mb-8">
            Создайте идеальный план для вашего путешествия
          </p>

          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 mb-8">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Город вылета
                </label>
                <input
                  type="text"
                  name="departureCity"
                  value={formData.departureCity}
                  onChange={handleChange}
                  required
                  placeholder="Москва"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Пункт назначения
                </label>
                <input
                  type="text"
                  name="destination"
                  value={formData.destination}
                  onChange={handleChange}
                  placeholder="Вьетнам"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Дата поездки
                </label>
                <input
                  type="date"
                  name="date"
                  value={formData.date}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Бюджет ($)
                </label>
                <input
                  type="number"
                  name="budget"
                  value={formData.budget}
                  onChange={handleChange}
                  required
                  placeholder="1000"
                  min="0"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold py-4 px-6 rounded-lg transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg"
            >
              {loading ? '🔄 Генерация плана...' : '✨ Сгенерировать план'}
            </button>
          </form>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-8">
              <p className="text-red-600 dark:text-red-400 font-medium">❌ {error}</p>
            </div>
          )}

          {travelPlan && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">
                📋 {travelPlan.title || 'Ваш план путешествия'}
              </h2>

              {usedRag !== null && (
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full mb-6 ${
                    usedRag
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                  title={
                    usedRag
                      ? 'План сгенерирован с использованием базы знаний (RAG)'
                      : 'База знаний не использована: план построен на общих знаниях модели. Проверьте SUPABASE_ANON_KEY и npm run index'
                  }
                >
                  {usedRag
                    ? '📚 База знаний использована'
                    : '📚 База знаний не использована — общие знания модели'}
                </span>
              )}

              {travelPlan.totalBudget && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
                  <p className="text-green-700 dark:text-green-300 font-semibold">
                    💰 Общий бюджет: ${travelPlan.totalBudget}
                  </p>
                </div>
              )}

              {/* Progress Indicator */}
              {travelPlan.steps && travelPlan.steps.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-blue-700 dark:text-blue-300 font-semibold">
                      📊 Прогресс выполнения
                    </p>
                    <p className="text-blue-700 dark:text-blue-300 font-semibold">
                      {getCompletedCount()} из {getTotalSteps()} шагов ({getProgressPercentage()}%)
                    </p>
                  </div>
                  <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-3">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${getProgressPercentage()}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {travelPlan.steps && travelPlan.steps.length > 0 && (
                <div className="space-y-4">
                  {travelPlan.steps.map((step) => {
                    const isCompleted = completedIds.has(step.id);
                    return (
                      <div
                        key={step.id}
                        className={`border-2 rounded-lg overflow-hidden transition-all duration-200 ${
                          isCompleted
                            ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                        }`}
                      >
                        <div className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2 flex items-center gap-2">
                                {isCompleted ? '✅' : '☐'} {step.title}
                              </h3>
                              <p className="text-gray-600 dark:text-gray-300 mb-3">
                                {step.description}
                              </p>

                              {step.actions && step.actions.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                                    Действия:
                                  </p>
                                  <ul className="space-y-1">
                                    {step.actions.map((action, idx) => (
                                      <li key={idx} className="text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2">
                                        <span>•</span>
                                        <span>{action}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {step.links && step.links.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-sm font-medium text-gray-700 dark:text-gray-400 mb-1">
                                    Полезные ссылки:
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {step.links.map((link, idx) => (
                                      <a
                                        key={idx}
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                      >
                                        🔗 {link.text}
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {step.cost > 0 && (
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                  💵 Ориентировочная стоимость: ${step.cost}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => toggleStepCompletion(step.id)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                                  isCompleted
                                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                                    : 'bg-green-500 hover:bg-green-600 text-white'
                                }`}
                              >
                                {isCompleted ? '↩️ Отменить' : '☑️ Отметить как сделанное'}
                              </button>
                              <button
                                onClick={() => handleQuestionClick(step.id)}
                                className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white transition-all"
                              >
                                ❓ У меня вопрос
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {travelPlan.tips && travelPlan.tips.length > 0 && (
                <div className="mt-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <h4 className="font-semibold text-yellow-800 dark:text-yellow-300 mb-2">💡 Полезные советы</h4>
                  <ul className="space-y-2">
                    {travelPlan.tips.map((tip, idx) => (
                      <li key={idx} className="text-yellow-700 dark:text-yellow-400 text-sm">
                        • {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <TokenStats />
    </div>
  );
}
