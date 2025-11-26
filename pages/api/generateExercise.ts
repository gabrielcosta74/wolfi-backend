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

// --- Helpers ---

function sanitizeExerciseIndex(index?: number): number {
  if (!index || Number.isNaN(index)) return 1;
  if (index < 1) return 1;
  if (index > 3) return 3;
  return Math.floor(index);
}

function pickExerciseType(
  subtopicName: string | undefined,
  difficulty: "easy" | "medium" | "hard",
  exerciseIndex: number,
): ExerciseType {
  const sub = (subtopicName || "").toLowerCase();

  // Exemplo: se o subtema mencionar "problema" → word problem
  if (sub.includes("problema") || sub.includes("aplicado")) {
    return "applied_word_problem";
  }

  if (difficulty === "easy") {
    return "basic_procedural";
  }

  if (difficulty === "hard") {
    // último exercício da sessão pode ser mais "estilo exame"
    if (exerciseIndex === 3) return "exam_multi_step";
    return "mixed_rules";
  }

  // dificuldade média
  if (exerciseIndex === 1) return "basic_procedural";
  return "mixed_rules";
}

// Fallback local com variedade e 1 única pergunta
function localFallback(exerciseIndex: number): ExerciseDefinition {
  if (exerciseIndex === 1) {
    return {
      statement:
        "Considera a função f(x) = 2x³ - 5x² + 3x - 1.\nCalcula f'(x).",
      exerciseType: "basic_procedural",
    };
  }

  if (exerciseIndex === 2) {
    return {
      statement:
        "Seja g(x) = (3x² + 1)·e^{2x}.\nCalcula g'(x) usando as regras do produto e, se necessário, da cadeia.",
      exerciseType: "mixed_rules",
    };
  }

  return {
    statement:
      "Numa prova de Matemática, a função h(x) = (4x - 3)·ln(x) modela uma certa grandeza.\nCalcula h'(x).",
    exerciseType: "applied_word_problem",
  };
}

// --- Handler ---

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
    let { subtopicName, difficulty, exerciseIndex } = body;

    const safeIndex = sanitizeExerciseIndex(exerciseIndex);
    const diff: "easy" | "medium" | "hard" = difficulty || "medium";
    const sub = subtopicName?.trim() || "Derivadas";

    const fallback = localFallback(safeIndex);
    const exerciseType = pickExerciseType(sub, diff, safeIndex);

    // Para o requirement de json_object: mencionar explicitamente JSON e estrutura
    const systemPrompt = `
Tu és o Wolfi, explicador de Matemática A (Portugal), habituado a preparar exercícios para Exames Nacionais.

Tens de CRIAR UM ÚNICO EXERCÍCIO (sem alíneas) focado num subtema específico.

Regras MUITO importantes para o enunciado:
- Cria APENAS UMA pergunta principal.
- NÃO incluas subquestões (nada de (a), (b), i), ii), etc.).
- Não peças várias coisas no mesmo enunciado (por exemplo, evita "calcula a derivada, estuda o sinal e determina máximos e mínimos" tudo junto).
- O exercício deve poder ser resolvido em 3–5 minutos por um aluno de Matemática A.
- Usa funções variadas e realistas para o secundário português:
  - polinómios (grau 1 a 4),
  - produtos ou quocientes de funções simples,
  - exponenciais ou logaritmos,
  - trigonométricas simples quando fizer sentido.
- Evita repetir sempre a mesma forma de função (NÃO uses sempre 3x^4 - 5x^3 + 2x - 7).
- Mantém o enunciado curto, claro e em Português de Portugal.

Tens de responder APENAS com um único objeto JSON com esta estrutura exata:
{
  "statement": "texto do enunciado em português, com \\n para quebras de linha, contendo UMA só pergunta",
  "exerciseType": "basic_procedural" | "mixed_rules" | "applied_word_problem" | "exam_multi_step"
}
Não incluas qualquer texto fora deste JSON. O output TEM de ser JSON válido.
`;

    const difficultyLabel =
      diff === "easy"
        ? "fácil (treino básico)"
        : diff === "hard"
        ? "difícil (nível mais próximo de exame, mas ainda só uma pergunta)"
        : "médio";

    const userPrompt = `
Subtema: ${sub}
Dificuldade: ${difficultyLabel}
Exercício nº: ${safeIndex}
Tipo de exercício pretendido: ${exerciseType}

Cria UM ÚNICO exercício adequado a este subtema e dificuldade, de forma que o aluno treine precisamente este conteúdo.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("generateExercise: failed to parse JSON from OpenAI", err);
      return res.status(200).json(fallback);
    }

    const statement =
      typeof parsed.statement === "string" && parsed.statement.trim().length > 0
        ? parsed.statement.trim()
        : fallback.statement;

    const allowedTypes: ExerciseType[] = [
      "basic_procedural",
      "mixed_rules",
      "applied_word_problem",
      "exam_multi_step",
    ];

    const finalExerciseType: ExerciseType = allowedTypes.includes(
      parsed.exerciseType,
    )
      ? parsed.exerciseType
      : exerciseType;

    return res.status(200).json({
      statement,
      exerciseType: finalExerciseType,
    });
  } catch (err) {
    console.error("Error in /api/generateExercise:", err);
    const fallback = localFallback(1);
    return res.status(200).json(fallback);
  }
}
