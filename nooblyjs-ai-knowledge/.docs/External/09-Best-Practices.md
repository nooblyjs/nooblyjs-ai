# Best Practices & Tips

## 🎯 Getting the Most from the noobly Wiki

The noobly Wiki is most valuable when used consistently and collaboratively. This chapter shares practical tips and best practices to maximize your productivity.

---

## 📚 Reading & Learning Best Practices

### The "30-Minute Deep Dive"

For complex topics:
1. **Set a timer for 30 minutes**
2. Start with a related document
3. Take notes on key concepts
4. Follow one or two links to related docs
5. Summarize what you learned in a note
6. Come back tomorrow—most learning happens after sleep!

### The "Breadcrumb Trail" Method

Use the breadcrumb to guide your learning:
1. **Click the deepest document** first (most specific)
2. **Click up one level** to understand context
3. **Click the space name** to see the big picture
4. Come back to the specific doc with full understanding

### Skim Before Deep Dive

When encountering new document:
1. Read the **title and first paragraph** (2 min)
2. Skim all **headings and summaries** (2 min)
3. Check **linked documents** to see what's related (2 min)
4. Ask AI chat a quick question about it (2 min)
5. Decide if you need deep dive (2 min) or you're done (18 min saved!)

### Building a "Favorites" System

Track documents you return to often:
1. **Pin 5-10 key documents** to your dashboard
2. Use **meaningful labels** when pinning ("My go-to API docs")
3. Organize pins by topic if you have many
4. Review and update your pins monthly

---

## 🔍 Smart Searching

### Search Strategy: From Broad to Specific

1. **Broad search**: "API" (see what exists)
2. **Filtered search**: "API" + Filter by Folder "Architecture" (narrow it)
3. **Specific search**: "API rate limiting" (precise answer)
4. **AI search**: Ask "How do rate limits work?" (contextual answer)

### Building Your Search Vocabulary

Over time, learn your organization's terminology:
- Is it "deploy" or "release"?
- Is it "process flow" or "workflow"?
- Is it "incident" or "problem"?
- Note the correct terms in your notes for future searches

### Saving Effective Searches

If you search for the same thing repeatedly:
1. **Do the search** and apply filters
2. Click **"Save Search"** (if available)
3. Give it a meaningful name: "High-Priority Incidents"
4. Access it anytime from your profile

### Search Aliases (Your Personal Reference)

In your notes, create quick references:
```
# My Search Aliases

- API Docs: search "API authentication" + folder filter "API Documentation"
- HR Process: search "employee" + space "People Team"
- Status: search "status report" + type "markdown"
```

Come back to this note when you want to run these searches again.

---

## 💬 Effective Commenting

### When to Comment (vs. Create a Document)

| Scenario | Action |
|----------|--------|
| Typo found | Comment to alert author |
| Disagreement | Comment to discuss alternatives |
| Question | Comment to ask for clarification |
| New idea | Create a document with full context |
| Approval | Comment to confirm it's good |
| Major feedback | Comment linking to a detailed doc |

### Comment Best Practices

**Good comment:**
> @ Alex: Great explanation! Does this also apply to batch processing? Asking because we discussed this in Sprint Planning yesterday.

**Avoid:**
> This is wrong. (No context, no constructive feedback)

### Managing Comment Threads

1. **Reply to the specific comment** you're addressing
2. **Mention relevant people**: @ manager for approval, @ expert for technical questions
3. **Reference other docs**: "Similar pattern in [Document]"
4. **Use threads** to keep related discussion together
5. **Resolve** when the issue is addressed

### Comment Notifications

Check your notifications regularly:
- Comments on your documents (someone asking about your work)
- Mentions (someone @ you specifically)
- Reviews (someone asking for feedback)

**Respond to comments within 24 hours** if possible.

---

## 🔗 Creating Knowledge Networks

### The Relationship Map

Connect related documents intentionally:

```
System Architecture (overview)
    ├─ Component A (details)
    ├─ Component B (details)
    └─ Deployment (how it runs)

Each component links to:
    ├─ API Documentation
    ├─ Configuration Guide
    └─ Troubleshooting
```

### Linking Strategy

When creating a document:
1. **Link to prerequisite** knowledge at the top ("Read this first")
2. **Link to related** concepts in the middle (context)
3. **Link to next steps** at the bottom ("Then read...")

### The "See Also" Section

End your documents with:

```markdown
## See Also

- **Prerequisites**: [Getting Started]
- **Related Topics**: [Topic A], [Topic B]
- **Advanced**: [Deep Dive Document]
- **Examples**: [Code Sample]
```

This guides readers on where to go next.

---

## ✍️ Writing Great Documentation

### The Five-Minute Document

Not every document needs to be comprehensive. Quick wins:

1. **Problem/Solution docs** (2-3 paragraphs)
2. **Quick Reference guides** (lists and tables)
3. **FAQ pages** (Q&A pairs)
4. **Checklists** (actionable steps)
5. **Decision records** (why we chose this)

These are valuable even if short!

### Document Templates

Create templates for common doc types:

**Template: Process Document**
```markdown
# [Process Name]

## Overview
What is this process and why do we use it?

## Prerequisites
What should you know first?

## Steps
1. Step one
2. Step two
3. Step three

## Troubleshooting
Common problems and solutions.

## See Also
- Related processes
- Reference docs
```

### Maintenance Schedule

Keep documents current:
- **Quarterly review**: Check if info is still accurate
- **Update date**: Edit the "Last Updated" field
- **Version notes**: If it changed, add "Updated: X"
- **Archive old docs**: Mark deprecated versions clearly

### Progress Indicators

Help others understand document status:

```
⚠️ DRAFT - Not yet approved by the team
✅ APPROVED - Ready to follow
🔄 IN PROGRESS - Currently being updated
📋 ARCHIVED - Outdated, use [New Document] instead
```

---

## 👥 Collaboration Best Practices

### Dividing Document Work

For large documents:
1. **Outline first**: Agree on structure
2. **Divide sections**: Each person owns one
3. **Link for context**: Each section links to related docs
4. **Review together**: Read each other's sections before publishing
5. **Decide on tone**: Make it sound like one voice

### Async Collaboration (For Distributed Teams)

1. **Create the document** with a rough structure
2. **Invite reviewers** and set a deadline (e.g., 3 days)
3. **Reviewers add comments** with feedback
4. **Address comments** and mark resolved
5. **Thank reviewers** when done

### Handling Disagreements

1. **Document both viewpoints** in comments (not an edit war)
2. **Link to supporting docs** for each position
3. **Propose compromise** in comments
4. **If unresolved**: Escalate to a team meeting discussion
5. **Document the decision** once made

### Reusing & Improving

When you find a document:
1. **Use it as-is** if it meets your needs
2. **Comment with improvements** instead of editing
3. **Share your comment** with the author
4. **Author improves it** for everyone
5. **Thank them** for improving shared knowledge

---

## 🎯 Personal Productivity Tips

### The "Weekly Review"

Every Friday afternoon (15 minutes):
1. **Review your notes** from the week
2. **Categorize** them (questions, answers, action items)
3. **Address action items** or move to next week
4. **Clean up** outdated notes
5. **Identify** documentation you should create

### The "Onboarding Survival Kit"

As a new person learning the system:
1. **Create a document**: "My Learning Path"
2. **Link 8-10 essential docs**
3. **Add notes** explaining why each is important
4. **Update as you learn** what else is important
5. **Share with next new person** (they'll thank you!)

### The "Decision Journal"

Track decisions you make:
1. **When you make a choice**, create a quick note
2. **Document why**: What problem did it solve?
3. **Link to supporting docs**
4. **Later**: Refer back to understand your past thinking
5. **Even later**: Share with others making similar choices

### The "Quick Reference**"

For tools/concepts you use frequently:
1. **Create a short document** (not comprehensive)
2. **List 5-10 key facts**
3. **Add examples**
4. **Bookmark it** (pin or browser bookmark)
5. **Update when you learn more**

---

## ⏰ Time Management

### Balancing Reading vs. Doing

- **New task**: 80% doing, 20% reading/learning (most learning happens doing)
- **Unfamiliar task**: 50% reading, 50% doing
- **Complex domain**: 30% reading, 70% doing (but spread learning over time)
- **Strategic planning**: 70% reading/research, 30% documentation

### The "Question vs. Search" Decision

**Ask in chat if**:
- You're in a hurry
- Question might be answered in multiple docs
- You want context beyond just facts

**Search if**:
- You have time to read
- You want to understand context
- You're researching a topic deeply

### Batch Your Reading

Instead of constant interruptions:
1. **Set a reading time**: 3pm daily, or Monday morning
2. **Collect links**: Add to a "To Read" list
3. **During reading time**: Power through multiple docs
4. **Take notes**: Batch your learning
5. **Resume work**: No interruption to your flow

---

## 🏗️ Contributing at Scale

### Your Role as a Contributor

As you grow more knowledgeable:
1. **Create documents** sharing your expertise
2. **Review others' documents** and provide feedback
3. **Maintain existing docs** you care about
4. **Link new docs** to existing knowledge
5. **Mentor new people** using the repository

### Building a Knowledge Maintenance Culture

For your team:
1. **Schedule documentation sprints** (1 hour per sprint)
2. **Assign document owners** (who maintains it?)
3. **Review cycle**: Quarterly check if still accurate
4. **Celebrate contributions**: Thank people who create/improve
5. **Make it part of job expectations**: Not extra, but expected

### Quality Standards

Agree with your team on:
- **Minimum length**: (not too thin)
- **Required sections**: (overview, how-to, examples, links)
- **Review process**: (who approves before publishing?)
- **Tone**: (technical, friendly, business-formal?)
- **Version control**: (How do you handle updates?)

---

## 🆘 Productivity Troubleshooting

| Problem | Solution |
|---------|----------|
| Too many documents, overwhelmed | Use filters and spaces. Read overviews first. Ask AI chat for summaries. |
| Can't remember what I read | Improve note-taking. Review your notes regularly. Create a personal summary. |
| Finding documents every time | Pin key docs. Create saved searches. Organize your bookmarks. |
| Spending too much time searching | Learn the org's terminology. Build a mental map of where things live. |
| Comments pile up, get lost | Reply to each, mark resolved. Review resolved comments weekly. |
| Documents get outdated quickly | Assign ownership. Schedule maintenance. Use clear version indicators. |

---

## ✅ Best Practices Checklist

Regular habits to adopt:

- [ ] **Daily**: Search/browse for 15 min during standup or slow period
- [ ] **Weekly**: Review your notes and decide what to archive
- [ ] **Weekly**: Respond to comments within 24 hours
- [ ] **Monthly**: Review and update pins on your dashboard
- [ ] **Quarterly**: Read an overview of a topic new to you
- [ ] **Quarterly**: Improve one document you use often
- [ ] **Annually**: Create a new guide sharing your expertise

---

## 💡 Pro Tips

1. **Keyboard shortcuts**: Press `/?` to see all available shortcuts
2. **Browser back button**: Use it to navigate (keeps your history)
3. **Copy document links**: Share exact URL with colleagues
4. **Skim tables of contents**: Many docs have "On This Page" summary
5. **Use your browser's Find**: Ctrl+F to search within a document
6. **Open links in new tabs**: Middle-click or Ctrl+Click
7. **Print to PDF**: Browser Print → Save as PDF for offline reading
8. **Zoom in/out**: Ctrl+Plus/Minus if text is hard to read
9. **Dark mode**: Check your browser/OS settings (some views support it)
10. **Turn notifications on**: Know when documents you care about change

---

**Next Chapter:** [Troubleshooting & Support](10-Troubleshooting.md)
