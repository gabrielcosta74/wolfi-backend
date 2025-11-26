// pages/api/generateExercise.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin"; // ajusta o caminho se precisares

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
  subtopicId?: string;     // NOVO – preferível
  subtopicName?: string;   // fallback
  difficulty?: "easy" | "medium" | "hard";
  exerciseIndex?: number;  // 1, 2, 3
  goal?: "revision" | "exam"; // se quiseres usar mais tarde
};

// ---------- Helpers ----------

function sanitizeExerciseIndex(index?: number): number {
  if (!index || Number.isNaN(index)) return 1;
  if (index < 1) return 1;
  if (index > 3) return 3;
  return Math.floor(index);
}

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

function pickExerciseType(
  subtopicName: string | undefined,
  difficulty: "easy" | "medium" | "hard",
  exerciseIndex: number,
): ExerciseType {
  const sub = (subtopicName || "").toLowerCase();

  // Se o subtema for claramente de aplicação/modelação
  if (sub.includes("resolução de problemas") || sub.includes("modelação")) {
    return exerciseIndex === 3 ? "exam_multi_step" : "applied_word_problem";
  }

  if (difficulty === "easy") {
    // primeiro exercício mais mecânico
    return "basic_procedural";
  }

  if (difficulty === "hard") {
    // no difícil, o 3º pode ser estilo exame
    if (exerciseIndex === 3) return "exam_multi_step";
    return "mixed_rules";
  }

  // dificuldade média
  if (exerciseIndex === 1) return "basic_procedural";
  if (exerciseIndex === 2) return "mixed_rules";
  return "applied_word_problem";
}

// ---------- carregar subtema + tópico do Supabase ----------

async function fetchSubtopicContext(body: RequestBody) {
  const { subtopicId, subtopicName } = body;

  let query = supabaseAdmin
    .from("subtopics")
    .select(
      `
      id,
      name,
      ai_notes,
      topic:topics (
        name,
        year,
        official_code
      )
    `
    )
    .limit(1);

  if (subtopicId) {
    query = query.eq("id", subtopicId);
  } else if (subtopicName) {
    // procura por nome aproximado se não tivermos id
    query = query.ilike("name", subtopicName);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("generateExercise: error fetching subtopic", error);
    return null;
  }
  if (!data) return null;

  return {
    subtopicName: data.name as string,
    aiNotes: (data.ai_notes as string | null) || "",
    topicName: (data.topic?.name as string | null) || null,
    topicYear: (data.topic?.year as number | null) || null,
    topicCode: (data.topic?.official_code as string | null) || null,
  };
}

// ---------- Handler ----------

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
    const safeIndex = sanitizeExerciseIndex(body.exerciseIndex);
    const difficulty: "easy" | "medium" | "hard" = body.difficulty || "medium";

    // 1) Tentar buscar contexto real do subtema na BD
    const ctx = await fetchSubtopicContext(body);

    const subtopicLabel = ctx?.subtopicName || body.subtopicName || "Subtema de derivadas";
    const aiNotes = ctx?.aiNotes || "";
    const topicLabel = ctx?.topicName || "Matemática A";
    const yearLabel = ctx?.topicYear ? `${ctx.topicYear}.º ano` : "10.º–12.º ano";
    const officialCode = ctx?.topicCode || "FRVR";

    const fallback = localFallback(safeIndex);
    const exerciseType = pickExerciseType(subtopicLabel, difficulty, safeIndex);

    const difficultyLabel =
      difficulty === "easy"
        ? "fácil (treino básico, cálculo mais direto)"
        : difficulty === "hard"
        ? "difícil (nível mais próximo de exame, mas ainda uma só pergunta)"
        : "médio (nível intermédio)";

    // 2) Prompt MUITO explícito para JSON e 1 só pergunta
    const systemPrompt = `
Tu és o Wolfi, explicador de Matemática A (Portugal), a preparar exercícios alinhados com o programa oficial (${officialCode}) do ${yearLabel}.

Vais criar APENAS UM exercício (sem alíneas), focado num subtema específico.

Contexto curricular:
- Tópico: ${topicLabel}
- Subtema: ${subtopicLabel}
- Conteúdos trabalhados neste subtema (resumo):
${aiNotes || "- (sem notas adicionais)"}

Regras MUITO importantes:
- Cria APENAS UMA pergunta principal (uma só tarefa para o aluno).
- Não uses alíneas (nada de (a), (b), i), ii), etc.).
- Não peças várias coisas numa só frase (por exemplo, evita "calcula a derivada, estuda o sinal e determina máximos e mínimos" tudo ao mesmo tempo).
- O exercício deve poder ser resolvido em 3–5 minutos por um aluno de Matemática A.
- Usa funções variadas e realistas para o secundário português:
  - polinómios (grau 1 a 4),
  - produtos ou quocientes de funções simples,
  - exponenciais ou logaritmos,
  - trigonométricas simples, quando fizer sentido.
- Evita repetir sempre a mesma função; varia coeficientes e formas.

Saída em json:
Tens de responder APENAS com um único objeto json com a estrutura exata:
{
  "statement": "texto do enunciado em português, com \\n para quebras de linha, contendo UMA só pergunta",
  "exerciseType": "basic_procedural" | "mixed_rules" | "applied_word_problem" | "exam_multi_step"
}
NÃO incluas qualquer texto fora deste json. O output TEM de ser json válido.
`;

    const userPrompt = `
Pretende-se um exercício para uma sessão de prática guiada.

Dados da sessão:
- Dificuldade: ${difficultyLabel}
- Número do exercício na sessão: ${safeIndex} (1 a 3)
- Tipo de exercício pretendido para este subtema: ${exerciseType}

Cria UM ÚNICO exercício que treine especificamente este subtema e nível de dificuldade, seguindo as regras.
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
