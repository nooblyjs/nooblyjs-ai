/**
 * @fileoverview Continuous Exploration AI Orchestrator
 *
 * Wraps the platform's aiservice with two continuous-exploration-shaped operations:
 *
 *   generate(project, template, requirement)
 *     → runs one AI call per document declared on the template,
 *       returns [{ name, content, model }]. The caller persists each.
 *
 *   chat(project, template, history, userMessage, knownDocs)
 *     → runs a single conversational AI call. The "system" framing includes
 *       the template's systemPrompt, the project's requirement, and a
 *       summary of any already-generated docs so the assistant can refine
 *       rather than re-derive.
 *
 * The aiservice exposes .prompt(text, options) → { content, model, ... }.
 * Ollama (the default backend) doesn't support a system role natively, so we
 * just inline the system framing into the user prompt. This keeps the
 * orchestrator provider-agnostic.
 */

'use strict';

class AIOrchestrator {
  constructor(aiservice, log) {
    this.aiservice = aiservice || null;
    this.log = log || console;
  }

  available() {
    return !!(this.aiservice && typeof this.aiservice.prompt === 'function');
  }

  // ─── Generation ─────────────────────────────────────────────────────────

  async generate({ project, template, requirement, contextDigest }) {
    if (!this.available()) {
      throw new Error('AI service not configured');
    }
    const docs = (template && Array.isArray(template.documents) && template.documents.length)
      ? template.documents
      : [{ name: 'continuous-exploration.md', prompt: 'Produce a single architecture & design document.' }];

    const results = [];
    for (const doc of docs) {
      const prompt = this._buildDocPrompt({ project, template, requirement, doc, contextDigest });
      try {
        const res = await this.aiservice.prompt(prompt, { temperature: 0.4 });
        results.push({
          name: doc.name.endsWith('.md') ? doc.name : `${doc.name}.md`,
          content: (res && res.content) || '',
          model: (res && res.model) || null
        });
      } catch (err) {
        this.log.error(`[continuous-exploration] generate failed for doc "${doc.name}":`, err.message);
        results.push({
          name: doc.name.endsWith('.md') ? doc.name : `${doc.name}.md`,
          content: `# ${doc.name}\n\n_Generation failed: ${err.message}_\n`,
          model: null,
          error: err.message
        });
      }
    }
    return results;
  }

  // ─── Chat ───────────────────────────────────────────────────────────────

  async chat({ project, template, history, userMessage, knownDocs, contextDigest }) {
    if (!this.available()) {
      throw new Error('AI service not configured');
    }
    const prompt = this._buildChatPrompt({ project, template, history, userMessage, knownDocs, contextDigest });
    const res = await this.aiservice.prompt(prompt, { temperature: 0.6 });
    return {
      content: (res && res.content) || '',
      model: (res && res.model) || null
    };
  }

  // ─── Prompt builders ────────────────────────────────────────────────────

  _buildDocPrompt({ project, template, requirement, doc, contextDigest }) {
    const lines = [];
    lines.push('You are Continuous Exploration, an architecture & design assistant.');
    lines.push('Produce a clear, focused Markdown document. No preamble, no closing remarks — output Markdown only.');
    if (template && template.systemPrompt) {
      lines.push('');
      lines.push('# Template context');
      lines.push(template.systemPrompt);
    }
    if (contextDigest) {
      lines.push('');
      lines.push(contextDigest);
    }
    lines.push('');
    lines.push(`# Project: ${project.name}`);
    if (project.description) lines.push(project.description);
    lines.push('');
    lines.push('# Requirement');
    lines.push(requirement || '(no requirement supplied)');
    lines.push('');
    lines.push(`# Your task: produce ${doc.name}`);
    if (doc.prompt) lines.push(doc.prompt);
    lines.push('');
    lines.push(`Begin the document with a top-level "# ${this._title(doc.name)}" heading.`);
    return lines.join('\n');
  }

  _buildChatPrompt({ project, template, history, userMessage, knownDocs, contextDigest }) {
    const lines = [];
    lines.push('You are Continuous Exploration, an architecture & design assistant. Be concise and concrete.');
    if (template && template.systemPrompt) {
      lines.push('');
      lines.push('# Template context');
      lines.push(template.systemPrompt);
    }
    if (contextDigest) {
      lines.push('');
      lines.push(contextDigest);
    }
    lines.push('');
    lines.push(`# Project: ${project.name}`);
    if (project.description) lines.push(project.description);
    if (project.requirement) {
      lines.push('');
      lines.push('# Requirement');
      lines.push(project.requirement);
    }
    if (Array.isArray(knownDocs) && knownDocs.length) {
      lines.push('');
      lines.push('# Documents already drafted for this project');
      for (const d of knownDocs) lines.push(`- ${d.name}`);
    }
    if (Array.isArray(history) && history.length) {
      lines.push('');
      lines.push('# Conversation so far');
      for (const m of history.slice(-12)) {
        lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
      }
    }
    lines.push('');
    lines.push(`User: ${userMessage}`);
    lines.push('Assistant:');
    return lines.join('\n');
  }

  _title(name) {
    return String(name).replace(/\.md$/i, '').replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}

module.exports = AIOrchestrator;
