import { useState } from "react";
import { api } from "@/lib/tauri";

interface TableSchema {
  schema: string;
  name: string;
  columns?: Array<{
    name: string;
    type: string;
    nullable: boolean;
  }>;
}

export function useAIGeneration() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSQL = async (
    instruction: string,
    existingSQL: string,
    tables: TableSchema[],
    onStream: (chunk: string) => void
  ) => {
    setGenerating(true);
    setError(null);

    try {
      const settings = await api.settings.getAll();
      const apiKey = settings.openai_api_key;
      const endpoint = settings.openai_endpoint || "https://api.openai.com/v1";
      const model = settings.openai_model || "gpt-4.1";

      if (!apiKey) {
        throw new Error("OpenAI API key not configured. Please add it in Settings.");
      }

      const systemPrompt = `You are a PostgreSQL SQL expert. Generate SQL queries based on user instructions.

Available tables and schemas:
${tables.map(t => `${t.schema}.${t.name}${t.columns ? `\n  Columns: ${t.columns.map(c => `${c.name} (${c.type}${c.nullable ? ', nullable' : ''})`).join(', ')}` : ''}`).join('\n\n')}

Rules:
- Return ONLY the raw SQL query, no markdown formatting, no code blocks, no explanations
- Use proper PostgreSQL syntax
- Consider the existing SQL if provided as context`;

      const userPrompt = existingSQL
        ? `Modify this SQL query:\n\`\`\`sql\n${existingSQL}\n\`\`\`\n\nInstruction: ${instruction}`
        : `Generate SQL query: ${instruction}`;

      const response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: true,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedResponse = "";
      let lastCleanedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                accumulatedResponse += content;
                
                // Clean the accumulated response
                let cleanedSQL = accumulatedResponse;
                
                // Remove opening ```sql or ``` if present at start
                cleanedSQL = cleanedSQL.replace(/^```sql\s*/i, '').replace(/^```\s*/i, '');
                
                // Only remove closing ``` if we've seen it
                if (cleanedSQL.includes('```')) {
                  cleanedSQL = cleanedSQL.replace(/\s*```$/i, '');
                }
                
                cleanedSQL = cleanedSQL.trim();
                
                // Only send the new portion since last update
                if (cleanedSQL.length > lastCleanedLength) {
                  const newContent = cleanedSQL.substring(lastCleanedLength);
                  lastCleanedLength = cleanedSQL.length;
                  onStream(newContent);
                }
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate SQL";
      setError(message);
      throw err;
    } finally {
      setGenerating(false);
    }
  };

  return { generateSQL, generating, error };
}
