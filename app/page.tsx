'use client';

import { useState } from 'react';

interface ChecklistItem {
  task: string;
  estimatedCost?: string;
  notes?: string;
}

interface ChecklistCategory {
  category: string;
  items: ChecklistItem[];
}

interface TravelPlan {
  title?: string;
  description?: string;
  checklist?: ChecklistCategory[];
  totalBudget?: string;
  tips?: string[];
}

export default function Home() {
  const [formData, setFormData] = useState({
    departureCity: '',
    destination: 'Вьетнам',
    date: '',
    budget: '',
  });

  const [loading, setLoading] = useState(false);
  const [travelPlan, setTravelPlan] = useState<TravelPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setTravelPlan(null);

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
      setTravelPlan(data);
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

              {travelPlan.description && (
                <p className="text-gray-600 dark:text-gray-300 mb-6">{travelPlan.description}</p>
              )}

              {travelPlan.totalBudget && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
                  <p className="text-green-700 dark:text-green-300 font-semibold">
                    💰 Общий бюджет: {travelPlan.totalBudget}
                  </p>
                </div>
              )}

              {travelPlan.checklist && travelPlan.checklist.length > 0 && (
                <div className="space-y-6">
                  {travelPlan.checklist.map((category, idx) => (
                    <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      <h3 className="bg-gray-100 dark:bg-gray-700 px-4 py-3 font-semibold text-gray-800 dark:text-white">
                        📌 {category.category}
                      </h3>
                      <div className="p-4 space-y-3">
                        {category.items.map((item, itemIdx) => (
                          <div key={itemIdx} className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <div className="flex-1">
                              <p className="text-gray-800 dark:text-gray-200 font-medium">{item.task}</p>
                              {item.estimatedCost && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                  💵 {item.estimatedCost}
                                </p>
                              )}
                              {item.notes && (
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 italic">
                                  📝 {item.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
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
    </div>
  );
}
