import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic',
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { departureCity, date, budget, destination } = body;

    if (!departureCity || !date || !budget) {
      return NextResponse.json(
        { error: 'Missing required fields: departureCity, date, budget' },
        { status: 400 }
      );
    }

    const prompt = `Сгенерируй план путешествия в ${destination || 'Вьетнам'} на ${date} с бюджетом ${budget}$. Вылет из ${departureCity}.

Пожалуйста, предоставь детальный план путешествия в формате JSON с следующей структурой:
{
  "title": "Название путешествия",
  "description": "Краткое описание",
  "checklist": [
    {
      "category": "Категория (например, 'Транспорт', 'Жилье', 'Достопримечательности')",
      "items": [
        {
          "task": "Описание задачи",
          "estimatedCost": "Ориентировочная стоимость",
          "notes": "Дополнительные заметки"
        }
      ]
    }
  ],
  "totalBudget": "Общий бюджет",
  "tips": ["Полезные советы"]
}`;

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Anthropic Messages API возвращает content как массив блоков
    const textBlock = response.content.find((block) => block.type === 'text');
    const content = textBlock && 'text' in textBlock ? textBlock.text : '';

    // Попытка распарсить JSON из ответа
    let jsonContent;
    try {
      // Извлекаем JSON из ответа, если модель обернула его в markdown
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonContent = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        jsonContent = JSON.parse(content);
      }
    } catch (e) {
      // Если не удалось распарсить JSON, возвращаем текстовый ответ
      jsonContent = {
        title: 'План путешествия',
        description: content,
        checklist: [],
        tips: [],
      };
    }

    // Extract usage information
    const usage = response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    } : null;

    return NextResponse.json({
      ...jsonContent,
      _tokenUsage: usage,
      _model: response.model,
    });
  } catch (error) {
    console.error('Error generating travel plan:', error);
    return NextResponse.json(
      { error: 'Failed to generate travel plan', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
