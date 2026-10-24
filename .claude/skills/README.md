# Project Skills

Custom skills for the nooblyjs-ai project to help understand and develop the codebase.

## Available Skills

### project-tutorial
**Command**: `/project-tutorial <project-name>`

Analyzes sub-projects and generates structured learning tutorials. Perfect for understanding what each part of the system does and how it works.

**Features**:
- Automatic code analysis
- Structured learning format (intro → learning → summary)
- Architecture visualization
- Cross-project comparison
- Code examples and references

**Examples**:
```
/project-tutorial nooblyjs-ai-design
/project-tutorial nooblyjs-ai-harness --detailed
/project-tutorial all
/project-tutorial nooblyjs-ai-host --mermaid
```

See `project-tutorial.md` for full documentation.

## How to Use Skills

1. Type the skill command with required parameters
2. Claude will analyze the project and generate a tutorial
3. Follow up with questions to dive deeper into specific areas
4. Use `--save` to export the tutorial as a document

## Project Structure

This monorepo contains 11 sub-projects:

| Project | Purpose |
|---------|---------|
| **nooblyjs-ai-design** | UI/UX design system and components |
| **nooblyjs-ai-desktop** | Desktop application shell |
| **nooblyjs-ai-factory** | Factory pattern implementations and generators |
| **nooblyjs-ai-harness** | Testing framework and development harness |
| **nooblyjs-ai-host** | Main application host/server |
| **nooblyjs-ai-infrastructure** | Cloud and deployment infrastructure |
| **nooblyjs-ai-knowledge** | Knowledge base and learning resources |
| **nooblyjs-ai-operations** | Operational tools and scripts |
| **nooblyjs-ai-product** | Product specification and requirements |
| **nooblyjs-ai-security** | Security policies and implementations |
| **nooblyjs-ai-teammate** | Teammate/collaboration features |

## Tips

- Start with `nooblyjs-ai-product` to understand the overall vision
- Then explore `nooblyjs-ai-host` to see the main application
- Use `--compare` to understand how projects relate to each other
- Reference the `/steering` folder for design, product, and roadmap docs
