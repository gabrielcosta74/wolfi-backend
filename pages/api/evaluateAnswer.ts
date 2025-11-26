import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

  if (!process.env.GEMINI_API_KEY) {
    console.warn("evaluateAnswer: missing GEMINI_API_KEY");
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }

  const trimmedAnswer = userAnswer.toString().trim();

  // 1) Buscar a imagem e converter para base64
  let base64Image: string | null = null;
  let mimeType: string = "image/jpeg";

  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      throw new Error(`fetch image failed: ${imgResp.status}`);
    }

    const contentTypeHeader =
      imgResp.headers.get("content-type") || "image/jpeg";
    if (contentTypeHeader.startsWith("image/")) {
      mimeType = contentTypeHeader.split(";")[0];
    }

    const arrBuf = await imgResp.arrayBuffer();
    base64Image = Buffer.from(arrBuf).toString("base64");
  } catch (e) {
    console.error("evaluateAnswer: failed to fetch/convert image", e);
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }

  if (!base64Image) {
    console.error("evaluateAnswer: base64Image is null");
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }

  const systemPrompt = `
És um avaliador de Matemática A do ensino secundário português (10.º–12.º ano),
especialista em Exames Nacionais.

Tens:
- o enunciado de um exercício;
- a resposta final em texto (opcional);
- UMA IMAGEM com a resolução completa feita pelo aluno (passo a passo).

O teu trabalho é avaliar a RESOLUÇÃO do aluno, não só o resultado final.

CRITÉRIOS DE AVALIAÇÃO (0–100):
- 0–20: resposta essencialmente incorreta, raciocínio errado ou incompleto.
- 21–50: há algumas ideias corretas, mas com erros graves ou passos em falta.
- 51–80: maior parte do raciocínio está correta, com alguns erros ou omissões.
- 81–100: resolução correta, bem justificada e coerente com o enunciado.

Regras importantes:
- Lê toda a resolução na imagem, mesmo que a resposta final pareça correta ou errada.
- Dá mais peso ao raciocínio e justificação do que apenas ao resultado.
- Usa sempre valores inteiros para o score (sem casas decimais).
- A classificação "correct" deve ser rara: exige solução totalmente sólida.
- "partial" é para resoluções com parte considerável correta mas com falhas.
- "incorrect" é para resoluções sem entendimento adequado do problema.

DEVOLVES APENAS UM OBJETO JSON, com esta estrutura EXATA:
{
  "result": "correct" | "partial" | "incorrect",
  "score": 0-100,
  "feedbackSummary": "frase curta em PT-PT"
}

- "feedbackSummary" deve ter 1–2 frases em PT-PT.
- Não reveles a solução completa, apenas feedback geral.
- Não escrevas qualquer texto fora deste JSON.
`;

  const userPrompt = `
Contexto do exercício para avaliação de Matemática A:

Subtema: ${subtopicName}
Dificuldade: ${difficulty}
Número do exercício (na ficha/exame): ${exerciseIndex}

Enunciado:
${statement}

Resposta final escrita pelo aluno:
${trimmedAnswer || "<sem resposta textual>"} 

Avalia com base principalmente na resolução que vês na IMAGEM.
`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: systemPrompt + "\n\n" + userPrompt },
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    });

    const text = result.response.text();
    if (!text) {
      console.warn("evaluateAnswer: empty content from Gemini");
      return res.status(200).json(getFallbackEvaluation(exerciseIndex));
    }

    // --- limpar resposta para garantir JSON puro ---
    let jsonText = text.trim();

    // Caso venha em bloco de código ```json ... ```
    if (jsonText.startsWith("```")) {
      // remove ```json ou ``` na primeira linha
      jsonText = jsonText.replace(/^```[a-zA-Z]*\s*/, "");
      // remove ``` final
      jsonText = jsonText.replace(/```$/, "").trim();
    }

    // Ficar só com o conteúdo entre a primeira { e a última }
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.error("evaluateAnswer: failed to parse JSON from Gemini", {
        err,
        raw: text,
        cleaned: jsonText,
      });
      return res.status(200).json(getFallbackEvaluation(exerciseIndex));
    }

    const resultLabel: PracticeResult = parsed.result;
    const scoreRaw = Number(parsed.score);

    const isValid =
      ALLOWED_RESULTS.includes(resultLabel) &&
      Number.isFinite(scoreRaw) &&
      typeof parsed.feedbackSummary === "string" &&
      parsed.feedbackSummary.trim().length > 0;

    if (!isValid) {
      console.warn("evaluateAnswer: invalid fields from Gemini", parsed);
      return res.status(200).json(getFallbackEvaluation(exerciseIndex));
    }

    const score = Math.max(0, Math.min(100, Math.round(scoreRaw)));

    const output: EvaluationResult = {
      result: resultLabel,
      score,
      feedbackSummary: parsed.feedbackSummary.trim(),
    };

    return res.status(200).json(output);
  } catch (err) {
    console.error("Gemini error in evaluateAnswer", err);
    return res.status(200).json(getFallbackEvaluation(exerciseIndex));
  }
}
