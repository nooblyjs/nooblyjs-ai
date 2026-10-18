# Finding What You Want: Search & Filtering

## 🔍 Basic Search

### Quick Search

1. Click the **search box** at the top of any page
2. Type a **keyword** or phrase (e.g., "API design", "onboarding process")
3. Press **Enter** or click the search icon
4. Results appear showing matching documents

The search engine looks through:
- Document titles
- Document content (text, headings, summaries)
- Folder names and descriptions

### Search Results

Each result shows:
- **Document title** (click to read)
- **Folder path** (where it's located)
- **Space name** (which space it's in)
- **Snippet** (excerpt showing where your keyword appears)
- **Document type** (PDF, markdown, image, etc.)
- **Last updated** (when it was changed)

---

## 🎯 Advanced Search Techniques

### Phrase Search (Exact Match)

Put quotes around multiple words to find exact phrases:
```
"API architecture"  ← finds this exact phrase
API architecture    ← finds docs with API, and/or architecture (less precise)
```

### Exclude Words

Use a minus sign (-) before a word to exclude it:
```
architecture -legacy
```
This finds documents about "architecture" but NOT "legacy architecture".

### Search Multiple Words (AND/OR)

By default, search looks for **all words**:
```
process automation
```
Finds docs with both "process" AND "automation".

To find docs with **either word**, separate with OR:
```
process OR workflow
```

### Wildcard Search

Use an asterisk (*) to match part of a word:
```
integrat*      ← finds: integrate, integration, integrating, etc.
API*           ← finds: API, APIs, APIKey, etc.
```

### Search Examples

| Search | Finds |
|--------|-------|
| `"API authentication"` | Exact phrase |
| `authentication -LDAP` | Without LDAP |
| `database OR schema` | Either topic |
| `integrat* security` | Integration + security |
| `"process automation" workflow` | All three concepts |

---

## 🏷️ Filtering Results

After you search, you'll see **filters** on the left sidebar to narrow results:

### Filter by Space
- Shows which spaces have matching documents
- Click a space name to see only results from that space
- "All Spaces" shows results from everywhere you have access to

### Filter by Folder
- Shows which folders contain matching documents
- Helps you understand the structure
- Click a folder to see only results from that folder

### Filter by Document Type
- **Text / Markdown**: Written documents
- **PDF**: PDF files
- **Image**: Diagrams, screenshots, photos
- **Code**: Source code files
- **Spreadsheet**: Excel or data files
- **Other**: Videos, diagrams, presentations

### Applying Multiple Filters

Filters work together (AND logic):
- Select Space: "Engineering" 
- AND Select Folder: "Architecture"
- Shows only Architecture documents from Engineering

### Clearing Filters

- Click the **X** next to a filter to remove it
- Click **Clear All** to reset all filters
- Start a new search to clear everything

---

## 💬 Chat-Powered Search

### Asking Natural Language Questions

Instead of typing keywords, you can ask questions:

1. Open the **chat panel** (right side, or chat icon)
2. Type a **question** like:
   - "What is our API authentication strategy?"
   - "How do I onboard a new team member?"
   - "Where is the database design documented?"
3. Press **Enter**
4. The AI reads relevant documents and provides an answer

### How Chat Search Works

The AI:
1. Understands your question
2. Searches for related documents
3. Reads the matching documents
4. Summarizes an answer for you
5. Shows you which documents it used

This is much faster than manual searching for complex questions.

### Chat Follow-Up Questions

You can ask follow-ups:
- **User**: "What is our API authentication?"
- **AI**: (answers about OAuth 2.0)
- **User**: "What about rate limiting?"
- **AI**: (answers about rate limits, from the same or related documents)

---

## 📊 Using Search Results

### Opening a Document from Results

1. Click the **document title** to open and read it
2. The search term is **highlighted** in the document
3. Use Ctrl+F (Cmd+F) to jump between highlights

### Pinning Search Results

Found something useful?
1. **Star icon** next to each result pins it to your dashboard
2. Later, you can access pinned items from your home

### Saving Search Filters

If you search frequently for the same thing:
1. Search and apply filters
2. Look for a **"Save Search"** option
3. Give it a name (e.g., "API Docs")
4. It will appear on your dashboard or in a "Saved Searches" list

### Sharing Results

To share what you found:
1. Click the **Share** button (or copy the URL from the address bar)
2. Send the link to a colleague
3. They'll see the same search results (and filters)

---

## 🎓 Search Tips & Tricks

### Tip 1: Start Broad, Then Filter
- Search: "architecture"
- Filter by Space: "Engineering"
- Filter by Folder: "System Design"
- This narrows results step-by-step

### Tip 2: Use Folder Navigation First
If you know roughly where something is:
1. Navigate to the space in the sidebar
2. Browse folders to find it
3. This is faster than searching for vague terms

### Tip 3: Search by Document Type
- Looking for a diagram? Search then filter by **Image**
- Looking for a process? Search then filter by **Markdown**
- Helps find the format you need

### Tip 4: Look at the Breadcrumb
When you find a document, the breadcrumb shows its path:
```
Engineering > Architecture > System Design > API Documentation
```
This helps you remember where to find similar docs in the future.

### Tip 5: Use the AI Chat for Complex Questions
Instead of multiple searches:
- ❌ Search "Azure", then search "DevOps", then search "Deployment"
- ✅ Ask: "How do we deploy to Azure?" (AI understands the whole question)

### Tip 6: Update Your Search Terms if No Results
If you get zero results:
1. Try a simpler keyword
2. Try a synonym (e.g., "process" instead of "workflow")
3. Remove filters and try again
4. Ask the AI chat instead—it handles vague questions better

---

## 🆚 Search vs. Browse

| Task | Use Search | Use Browse |
|------|-----------|-----------|
| Looking for a specific document | ✓ | |
| Want to explore a topic area | | ✓ |
| Know keywords but not location | ✓ | |
| Want to see folder structure | | ✓ |
| Searching across all spaces | ✓ | |
| Staying in one space | Either | ✓ |
| Quick fact lookup | ✓ | |
| Learning an unfamiliar area | | ✓ |

---

## ⚙️ Search Settings

### Changing How Many Results Show
- Results typically show **10-20 per page**
- Scroll to the bottom to load more (or click "Next Page")
- Results are ranked by relevance (most relevant first)

### Search Scope
- **Default**: Search all spaces you can access
- **In Current Space**: Some views let you search just the current space
- Check if a search scope filter is available near the search box

### Recent Searches
- The search box may show your **recent search terms**
- Click on a recent search to run it again

---

## 🆘 Troubleshooting Search

| Problem | Solution |
|---------|----------|
| No results found | Try simpler keywords, remove quotes, check filters. Ask the AI instead. |
| Too many results | Add more specific keywords or use filters to narrow down. |
| Can't find a document I know exists | You might not have access to that space. Ask your administrator. |
| Results seem irrelevant | Try different keywords or use the AI chat for context. |
| Search is slow | This might happen on very large repositories. Refine your search. |

---

## ✅ Search Checklist

After this section, you should be able to:

- [ ] Use the search box to find documents
- [ ] Apply filters to narrow results
- [ ] Use quote marks to search for exact phrases
- [ ] Understand which spaces and folders have results
- [ ] Open and read a document from search results
- [ ] Ask the AI chat a natural language question
- [ ] Pin useful documents from search results

---

**Next Chapter:** [Looking for Answers: Using Chat & AI](05-Chat-AI.md)
