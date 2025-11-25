// pages/api/generateExercise.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ExerciseType =
  | "basic_procedural"
  | "mixed_rules"
  | "applied_word_problem"
  | "exam_multi_step";

type ExerciseDefinition = {
  statement: string;
  exerciseType: ExerciseType;
};

type RequestBody = {
  subtopicName?: string;
  difficulty?: "easy" | "medium" | "hard";
  exerciseIndex?: number;
};

function localFallback(exerciseIndex: number): ExerciseDefinition {
  if (exerciseIndex === 1) {
    return {
      statement:
        "1) Considere a função f(x) = 3x² - 5x + 2.\nCalcula f'(x).",
      exerciseType: "basic_procedural",
    };
  }

  if (exerciseIndex === 2) {
    return {
      statement:
        "2) Considere g(x) = (2x + 1) · e^{x²}.\nUsa regras do produto e da cadeia para calcular g'(x).",
      exerciseType: "mixed_rules",
    };
  }

  return {
    statement:
      "3) Num exercício de exame, a função h modela o lucro diário:\n" +
      "h(x) = (4x - 3) · e^{0.5x}, onde x é o número de unidades produzidas.\n" +
      "Determina h'(x) e interpreta o seu significado.",
    exerciseType: "applied_word_problem",
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ExerciseDefinition | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body as RequestBody;
    const { subtopicName, difficulty, exerciseIndex } = body;

    if (
      typeof exerciseIndex !== "number" ||
      exerciseIndex < 1 ||
      exerciseIndex > 3
    ) {
      return res
        .status(400)
        .json({ error: "exerciseIndex must be 1, 2 or 3" });
    }

    const systemPrompt = `
Tu és o Wolfi, explicador de Matemática A (Portugal).
Gera UM exercício para o subtema "${subtopicName}", dificuldade "${difficulty}".
Devolve APENAS JSON com:
- "statement": string (texto do enunciado, com \\n para quebras de linha)
- "exerciseType": "basic_procedural" | "mixed_rules" | "applied_word_problem" | "exam_multi_step"
`;

    const userPrompt = `Este é o exercício nº ${exerciseIndex} da sessão.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content || "{}";
    const parsed = JSON.parse(raw);

    const fallback = localFallback(exerciseIndex);

    const statement =
      typeof parsed.statement === "string" && parsed.statement.trim().length > 0
        ? parsed.statement
        : fallback.statement;

    const exerciseType: ExerciseType =
      parsed.exerciseType &&
      ["basic_procedural", "mixed_rules", "applied_word_problem", "exam_multi_step"].includes(
        parsed.exerciseType,
      )
        ? parsed.exerciseType
        : fallback.exerciseType;

    return res.status(200).json({
      statement,
      exerciseType,
    });
  } catch (err) {
    console.error("Error in /api/generateExercise:", err);
    const fallback = localFallback(1);
    return res.status(200).json(fallback);
  }
}
