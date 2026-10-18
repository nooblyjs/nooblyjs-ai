# Looking for Answers: Using Chat & AI

## 💬 What is the Chat Assistant?

The **Chat Assistant** is an AI-powered tool that answers your questions by reading documents in the noobly Wiki. Instead of searching and reading multiple documents yourself, you ask a question and the AI finds the answer for you.

### When to Use Chat

- **Quick answers**: "What's our API rate limit?"
- **Learning**: "Explain our authentication strategy"
- **Decision support**: "What's the difference between these two approaches?"
- **Finding documents**: "Where is the database design documented?"
- **Complex questions**: "How do we deploy to Azure?"

The AI works best when you ask **complete questions in natural language**—just like you'd ask a colleague.

---

## 🚀 Getting Started with Chat

### Opening Chat

**Chat is usually open on the right side of the screen.** If you don't see it:

1. Look for the **chat icon** or **AI icon** in the toolbar
2. Click to open the chat panel
3. You'll see a message input box at the bottom

### Asking Your First Question

1. Click in the **chat input box** at the bottom
2. Type your question (e.g., "What is our API architecture?")
3. Press **Enter** or click the **Send button** (▶)
4. Wait for the AI to search and respond

### Reading the Response

The AI's response includes:
- **Answer text**: The main answer to your question
- **Sources**: Which documents the AI read to answer you
- **Links**: Click any document name to open it and read more

---

## 🎯 How to Ask Good Questions

### Good Questions vs. Vague Ones

| Vague | Good |
|-------|------|
| "API" | "What is our API authentication method?" |
| "deployment" | "How do we deploy the web app to production?" |
| "security" | "What encryption do we use for data at rest?" |
| "teams" | "How many people are on the Platform team?" |

**The more specific your question, the better the answer.**

### Question Templates

Use these starter phrases to form better questions:

- **"What is..."** → "What is our backup strategy?"
- **"How do we..."** → "How do we onboard new users?"
- **"Why do we..."** → "Why do we use Kubernetes?"
- **"When should I..."** → "When should I escalate a ticket?"
- **"Where is..."** → "Where is the database documentation?"
- **"Explain..."** → "Explain our CI/CD pipeline"
- **"Compare..."** → "Compare REST and GraphQL for our use case"

### Multi-Part Questions

You can ask complex questions:
- "What is our API authentication method, and what are its security benefits?"
- "How do we deploy, and what's the rollback process?"

The AI will address all parts.

---

## 💭 Multi-Turn Conversations

### Following Up

After the AI answers, you can ask follow-up questions:

```
You:  "What is our API authentication?"
AI:   "We use OAuth 2.0..."

You:  "What about rate limiting?"
AI:   "Rate limits are 1000 requests per minute..."

You:  "How do I implement this in Python?"
AI:   "Here's example code..."
```

The AI remembers your conversation and context.

### Asking for Clarification

If the answer isn't clear:
- "Can you explain that more simply?"
- "Give me an example"
- "What's the difference between these two approaches?"
- "Where exactly in the documentation is this?"

### Changing Topics

Start a new conversation:
1. Click **New Chat** or **Clear Conversation** (if available)
2. Ask your new question
3. The AI will start fresh without previous context

---

## 🔗 Using Sources & Links

### Understanding Sources

The AI shows you which documents it used to answer:

```
Answer: "We use OAuth 2.0 for API authentication..."

Sources:
• API Authentication Guide (API Documentation)
• Security Policy (Architecture)
```

Click any source to open and read the full document.

### Verifying Answers

Always check sources if:
- The answer is mission-critical
- You want more detail
- You want to share the answer with others
- You want to understand the context

This way, you get both the summary (from AI) and the full context (from the source document).

### Following the Trail

1. AI gives you an answer
2. You click a source to read more
3. That document might link to other documents
4. You can follow links to understand the whole topic

---

## 🎯 Chat Tips & Tricks

### Tip 1: Ask for Summaries
Instead of reading a long document:
- "Summarize the database design document"
- "Give me a quick overview of our disaster recovery plan"
- The AI reads it and gives you the essence

### Tip 2: Ask for Steps or Procedures
- "What are the steps to deploy a new service?"
- "How do I request access to the data warehouse?"
- The AI extracts step-by-step instructions from documents

### Tip 3: Compare and Contrast
- "What's the difference between our old and new API?"
- "Compare Kubernetes vs. Docker for our use case"
- "Should we use Cache A or Cache B?"

### Tip 4: Ask for Examples
- "Show me an example of our API request format"
- "Do you have an example of a good pull request?"
- "What does a completed onboarding look like?"

### Tip 5: Ask for Help with Documents
- "What's in the architecture diagrams folder?"
- "Are there any examples of database schemas?"
- "Where would I find information about security?"

### Tip 6: Use Chat While Reading a Document
1. Open a document in the main area
2. Chat appears on the right side
3. Ask questions about what you're reading
4. The AI uses the document you're reading as context

---

## 🔐 Privacy & What the AI Can See

### What the AI Can Access
- Documents in spaces you have permission to view
- Your question and conversation
- Basic information about documents (titles, folders, organization)

### What the AI Cannot Do
- Share your conversations with others (unless you share explicitly)
- Access documents outside your permissions
- Access your personal emails or files outside the noobly Wiki
- See your password or sensitive credentials

### Your Conversation Privacy
- Your chat history is saved on the system
- You can clear it if you want
- Check your organization's privacy policy for details

---

## ⚙️ Chat Settings & Controls

### Clearing Your Chat History
1. Look for a **Clear** or **New Chat** button
2. Click to start a fresh conversation
3. Previous chat is typically cleared

### Adjusting Chat Behavior
Some settings you might find:
- **Search Mode**: How the AI searches documents (comprehensive vs. quick)
- **Response Length**: Brief vs. detailed answers
- **Sources**: Show or hide which documents were used

Check your profile settings for chat preferences.

---

## 📊 Chat Examples

### Example 1: Quick Fact Lookup
```
Q: What's our API rate limit?
A: 1000 requests per minute per API key, with burst allowance 
   of 5000 requests. See Security Policy for details.
Sources: API Documentation, Rate Limiting Guide
```

### Example 2: Procedural Question
```
Q: How do I set up a development environment?
A: 
1. Clone the repository
2. Install Node.js 16+
3. Run npm install
4. Copy .env.example to .env
5. Run npm start
Sources: Developer Setup Guide, Getting Started
```

### Example 3: Decision Support
```
Q: Should we use GraphQL or REST?
A: For your use case:
- Use REST if: simple CRUD operations, caching is important
- Use GraphQL if: complex queries, multiple client types
- We currently use: REST for public APIs, GraphQL for internal
Sources: API Architecture, Technical Standards, API Comparison
```

### Example 4: Learning New Topic
```
Q: Explain microservices architecture
A: Microservices break an application into small, independent 
   services that communicate via APIs. Benefits include:
   - Easy to scale individual services
   - Teams can work independently
   - Easy to deploy changes...
Sources: Architecture Overview, System Design, Microservices Guide
```

---

## 🆘 When Chat Doesn't Help

### AI Says "I Don't Know"

This might mean:
- The information isn't in the noobly Wiki
- The documents use different terminology
- The question is outside the system's knowledge
- **What to do**: Try a different question, search manually, or ask a colleague

### Answer Seems Wrong

Always verify by:
1. Checking the sources
2. Reading the full documents
3. Asking a follow-up question for clarification
4. Comparing with other documents

### Can't Find What I Need

1. Try a different question format
2. Ask the AI to point you to relevant documents
3. Use search instead
4. Contact your team lead or administrator

---

## ✅ Chat Checklist

After this section, you should be able to:

- [ ] Open the chat panel
- [ ] Ask a clear, specific question
- [ ] Read and understand the AI's response
- [ ] Check the sources the AI used
- [ ] Ask follow-up questions
- [ ] Use chat to summarize documents
- [ ] Understand what information the AI can and cannot access
- [ ] Know when to use chat vs. manual search

---

## 📞 Chat Support

If chat isn't working:
- Is it enabled? (Check with your administrator)
- Are you logged in?
- Do you have permission to the relevant spaces?
- Try refreshing the page
- Check your internet connection

---

**Next Chapter:** [Contributing: Creating & Collaborating](06-Contributing.md)
