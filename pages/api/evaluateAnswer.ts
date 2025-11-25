import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type PracticeResult = "correct" | "partial" | "incorrect";

type EvaluationResult = {
  result: PracticeResult;
  score: number;
  feedbackSummary: string;
};

const ALLOWED_RESULTS: PracticeResult[] = ["correct", "partial", "incorrect"];

function getFallbackEvaluation(exerciseIndex: number = 1): EvaluationResult {
  if (exerciseIndex === 1) {
    return {
      result: "correct",
      score: 100,
      feedbackSummary: "Bom trabalho! Acertaste este exercício.",
    };
  }
  if (exerciseIndex === 2) {
    return {
      result: "partial",
      score: 60,
      feedbackSummary:
        "Quase lá. Vale a pena rever alguns passos deste tipo de exercício.",
    };
  }
  return {
    result: "incorrect",
    score: 20,
    feedbackSummary:
      "A tua resolução ainda precisa de reforço neste tipo de exercício.",
  };
}

function sanitizeExerciseIndex(index?: number): number {
  if (!index || Number.isNaN(index)) return 1;
  if (index < 1) return 1;
  if (index > 3) return 3;
  return Math.floor(index);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body: any;
  try {
    body = req.body;
  } catch (err) {
    console.error("evaluateAnswer: invalid JSON", err);
    return res.status(200).json(getFallbackEvaluation(1));
  }

  const {
    statement,
    userAnswer = "",
    imageUrl,
    subtopicName = "Derivadas",
    difficulty = "medium",
  } = body;

  const exerciseIndex = sanitizeExerciseIndex(body.exerciseIndex);

  if (!statement || typeof statement !== "string" || !statement.trim()) {
    console.warn("evaluateAnswer: missing statement");
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }

  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.trim()) {
    console.warn("evaluateAnswer: missing imageUrl");
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("evaluateAnswer: missing OPENAI_API_KEY");
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }

  const trimmedAnswer = userAnswer.toString().trim();

  // Busca a imagem e converte para data URL, forçando image/jpeg
  let dataUrl: string | null = null;
  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      throw new Error(`fetch image failed: ${imgResp.status}`);
    }
    const arrBuf = await imgResp.arrayBuffer();
    const base64 = Buffer.from(arrBuf).toString("base64");
    const contentType = "image/jpeg"; // força tipo suportado pelo OpenAI
    dataUrl = `data:${contentType};base64,${base64}`;
  } catch (e) {
    console.error("evaluateAnswer: failed to fetch/convert image", e);
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }

  const systemPrompt = `
És um avaliador de Matemática A do ensino secundário português (10.º–12.º ano),
especialista em Exames Nacionais.

Recebes:
- o enunciado de um exercício;
- a resposta final em texto (opcional);
- uma imagem com a resolução completa feita pelo aluno.

Objetivo:
1) Avaliar o raciocínio e a conclusão.
2) Classificar como "correct", "partial" ou "incorrect".
3) Dar um score 0–100.
4) Escrever um feedback muito curto (1–2 frases, PT-PT) sem revelar a solução completa.

Responde **apenas** com um único objeto JSON com esta estrutura exata:
{
  "result": "correct" | "partial" | "incorrect",
  "score": 0-100,
  "feedbackSummary": "frase curta em PT-PT"
}
Não incluas qualquer texto fora deste JSON.
`;


  const userPrompt = `
Subtema: ${subtopicName}
Dificuldade: ${difficulty}
Exercício: ${exerciseIndex}

Enunciado:
${statement}

Resposta final escrita pelo aluno:
${trimmedAnswer || "<sem resposta textual>"} 

Avalia com base na imagem da resolução.
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      console.warn("evaluateAnswer: empty content from OpenAI");
      return res.status(200).json(getFallbackEvaluation(exerciseIndex));
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error("evaluateAnswer: failed to parse JSON from OpenAI", err);
      return res.status(200).json(getFallbackEvaluation(exerciseIndex));
    }

    const isValid =
      ALLOWED_RESULTS.includes(parsed.result) &&
      Number.isFinite(parsed.score) &&
      parsed.score >= 0 &&
      parsed.score <= 100 &&
      typeof parsed.feedbackSummary === "string" &&
      parsed.feedbackSummary.length > 0;

    if (!isValid) {
      console.warn("evaluateAnswer: invalid fields from OpenAI", parsed);
      return res.status(200).json(getFallbackEvaluation(exerciseIndex));
    }

    const output: EvaluationResult = {
      result: parsed.result,
      score: parsed.score,
      feedbackSummary: parsed.feedbackSummary,
    };

    return res.status(200).json(output);
  } catch (err) {
    console.error("OpenAI error in evaluateAnswer", err);
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }
}
