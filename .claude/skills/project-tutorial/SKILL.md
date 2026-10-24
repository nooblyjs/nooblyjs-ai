---
name: project-tutorial
description: Analyze sub-projects and generate structured learning tutorials
---

# Project Tutorial Generator

This skill helps you understand your sub-projects by analyzing their code and generating interactive tutorials in a structured learning format.

## Available Sub-Projects

- nooblyjs-ai-design
- nooblyjs-ai-desktop
- nooblyjs-ai-factory
- nooblyjs-ai-harness
- nooblyjs-ai-host
- nooblyjs-ai-infrastructure
- nooblyjs-ai-knowledge
- nooblyjs-ai-operations
- nooblyjs-ai-product
- nooblyjs-ai-security
- nooblyjs-ai-teammate

## How It Works

When you invoke this skill with a project name:

1. **Analyze Phase**: I explore the project structure, key files, package.json, README, and source code
2. **Learn Phase**: I create a comprehensive tutorial that explains:
   - What the project is and its purpose
   - Core concepts and architecture
   - Key components and how they interact
   - Entry points and main workflows
   - Dependencies and external integrations
3. **Summary Phase**: You get a clear recap of what you've learned

## Tutorial Format

Each tutorial follows this structure:

### Introduction
- What you're about to learn
- Why it matters
- Prerequisites or related projects

### Core Learning
- **Purpose & Overview**: What the project does
- **Architecture**: How it's organized
- **Key Components**: Main modules and their responsibilities
- **How It Works**: Data flow and workflows
- **Key Technologies**: Tools, frameworks, libraries used

### Summary
- Main takeaways
- How it connects to other projects
- Next steps for deeper learning

## Usage

```
/project-tutorial nooblyjs-ai-design
/project-tutorial nooblyjs-ai-harness
/project-tutorial all  (generates overview of all projects)
```

## Options

- `--detailed`: Include code examples and specific file references
- `--mermaid`: Include architecture diagrams
- `--save`: Save tutorial as a document in the project
- `--compare <project2>`: Compare two projects' architectures

---

**Tip**: You can follow up with questions about specific components, and I'll dive deeper into any area you want to understand better.
