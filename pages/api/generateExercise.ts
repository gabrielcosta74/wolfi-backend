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
  exerciseIndex?: number; // 1, 2 ou 3
};

// --- Helpers ---

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

// Decide o tipo de exercício alvo com base no índice e dificuldade
function chooseExerciseTypeHint(
  exerciseIndex: number,
  difficulty: "easy" | "medium" | "hard",
): ExerciseType {
  if (exerciseIndex === 1) {
    return "basic_procedural";
  }

  if (exerciseIndex === 2) {
    return "mixed_rules";
  }

  // exerciseIndex === 3
  if (difficulty === "hard") {
    return "exam_multi_step";
  }

  return "applied_word_problem";
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
    const diff: "easy" | "medium" | "hard" =
      difficulty === "easy" || difficulty === "hard" ? difficulty : "medium";

    const sub = subtopicName?.trim() || "Derivadas";
    const fallback = localFallback(safeIndex);
    const typeHint = chooseExerciseTypeHint(safeIndex, diff);

    const systemPrompt = `
Tu és o Wolfi, explicador de Matemática A (Portugal, 10.º–12.º ano) focado em Exames Nacionais.

Vais gerar **UM único exercício** de Matemática A, em português de Portugal, para o subtema "${sub}".

Regras pedagógicas IMPORTANTES para o enunciado:
- O exercício tem de ter **apenas uma pergunta principal**.
- Podes dar 1–2 frases de contexto, mas NÃO cries uma ficha inteira nem muitas alíneas independentes.
- NÃO cries subquestões (nada de (a), (b), i), ii) com objetivos diferentes).
- Não peças várias coisas diferentes no mesmo enunciado (por exemplo, evita "calcula a derivada, estuda o sinal e determina máximos e mínimos" tudo junto).
- O exercício deve poder ser resolvido em 3–5 minutos por um aluno de Matemática A.
- Usa funções variadas e realistas para o secundário português:
  - polinómios (grau 1 a 4),
  - produtos ou quocientes de funções simples,
  - exponenciais ou logaritmos,
  - trigonométricas simples (sen, cos, e^x, etc.) quando fizer sentido para o subtema.
- Evita repetir sempre a mesma forma de função (NÃO uses sempre 3x^4 - 5x^3 + 2x - 7).
- Mantém o enunciado curto, claro e em Português de Portugal.

Diferença de dificuldades:
- **easy**:
  - foco em procedimentos básicos;
  - derivadas diretas de polinómios ou funções simples (no máximo uma regra).
- **medium**:
  - combinação de 2 regras (por exemplo: produto + cadeia, quociente, etc.);
  - cálculo mais trabalhoso, mas ainda directo.
- **hard**:
  - problemas que exigem interpretação (máximos/mínimos, taxa de variação, aplicações reais, estilo exame);
  - podem ter 1–2 passos de raciocínio, mas continuam a ter **uma pergunta principal**.

Tipos de exercício:
- "basic_procedural": treino rápido, derivar uma função concreta; quase sem contexto.
- "mixed_rules": função que obriga a usar várias regras de derivação.
- "applied_word_problem": problema com um contexto curto e uma pergunta clara (ex.: taxa de variação, máximo/mínimo, interpretação da derivada).
- "exam_multi_step": estilo exame nacional, com contexto mais longo e vários passos lógicos, mas ainda focado num objetivo principal.

Tens de responder **APENAS** em formato json, com um único objeto JSON com esta estrutura exata:
{
  "statement": "texto do enunciado em português, com \\n para quebras de linha, contendo UMA só pergunta",
  "exerciseType": "basic_procedural" | "mixed_rules" | "applied_word_problem" | "exam_multi_step"
}
Não incluas qualquer texto fora deste JSON. O output TEM de ser JSON válido.
Este texto é um lembrete para a API: a palavra json está presente na mensagem.
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
Tipo de exercício pretendido (hint): ${typeHint}

Gera UM ÚNICO exercício adequado a este subtema e dificuldade, de forma que o aluno treine precisamente este conteúdo.

Instruções específicas:
- Se o tipo for "basic_procedural":
  - Uma função simples e 1 pedido do tipo "calcula f'(x)" ou semelhante.
- Se o tipo for "mixed_rules":
  - Função que obrigue a combinar regras (produto, quociente, cadeia).
- Se o tipo for "applied_word_problem":
  - Problema com um contexto curto e uma pergunta clara (ex.: taxa de variação, máximo/mínimo, interpretação da derivada).
- Se o tipo for "exam_multi_step":
  - Estilo exame nacional: texto um pouco mais longo, exige planeamento, mas continua a ter uma pergunta principal muito clara.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
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

    const finalType: ExerciseType =
      parsed.exerciseType && allowedTypes.includes(parsed.exerciseType)
        ? parsed.exerciseType
        : typeHint;

    return res.status(200).json({
      statement,
      exerciseType: finalType,
    });
  } catch (err) {
    console.error("Error in /api/generateExercise:", err);
    const fallback = localFallback(1);
    return res.status(200).json(fallback);
  }
}
