# Spaces Management System

The Spaces Management System is a central organizational concept in the noobly Wiki Platform that provides a flexible, cross-module framework for managing organizational containers, access control, and shared configurations.

## Overview

Spaces are organizational units that can be used across the entire platform. They provide:
- **Centralized Access Control** - Manage who has access to resources
- **Flexible Configuration** - Store custom JSON configurations
- **Type-Based Organization** - Support multiple space types (projects, teams, workflows, archives, etc.)
- **Visibility Controls** - Public, private, or team-based visibility
- **Permission Management** - Read-only or read-write access levels

## Space Model

Each space contains the following properties:

```javascript
{
  // Identification
  id: Number,                  // Unique identifier
  name: String,                // Space name (unique)
  description: String,         // Space description

  // Organization
  type: String,                // Type: 'project', 'team', 'workflow', 'archive', etc.

  // Access Control
  visibility: String,           // 'public' | 'private' | 'team'
  permissions: String,          // 'read-only' | 'read-write'
  allowedUsers: Array,         // Array of user IDs with access

  // Presentation
  theme: Object|String,        // Optional brand applied while the space is open
                               // (object form below; a String names a preset)

  // Configuration
  configuration: {
    filing: {                  // Passed to the space's filing instance
      provider: String,        // 'local', ...
      baseDir: String,         // Content root (spaces MAY share one)
      maxFileSize: Number,
      allowedExtensions: Array
    },
    allowedPaths: Array,       // Optional: expose only these subtrees
    excludedPaths: Array       // Optional: carve-outs, these win over allowed
  },

  // Metadata
  metadata: Object,            // { archived: Boolean }
  createdAt: String,           // ISO timestamp
  createdBy: String,           // User ID of creator — ALSO an access grant
  updatedAt: String,           // ISO timestamp
  updatedBy: String            // User ID of last updater
}
```

> `createdBy` is not purely an audit field: it is read as an access grant by
> `spacePermissions.isSpaceAdmin()` and by every `spaceFilingRoutes` handler
> (`allowedUsers.includes(email) || space.createdBy === email`).

> Removed 2026-07-25: `configuration.features`, `configuration.maxSize`,
> `configuration.retentionDays` and `metadata.tags`. All four were seeded on
> every space and read by nothing.

## Theme

A space brands the wiki while it is open. The brand is DATA — adding one needs
no code:

```json
"theme": {
  "title": "Retail Wiki",
  "subtitle": "Wiki",
  "image": "/images/retail-logo.png",
  "color": "#0b182e",
  "color-highlight": "#edf0f5",
  "home": ".retail.md"
}
```

| Key | Effect |
|---|---|
| `title` | Topbar brand text and the browser tab title |
| `subtitle` | Small uppercase line under the title |
| `image` | Topbar logo and favicon. A WORDMARK (at least twice as wide as tall) drops the white chip, runs to the width of the brand column and suppresses the title/subtitle text beside it — at 264px there is room for one or the other, and the title still names the tab |
| `color` | The PRIMARY — ramp step 600 (buttons, links, active states) |
| `color-highlight` | The light tint — ramp step 100 (hover fills, soft panels) |
| `home` | The space's landing document (see below) |

The remaining six ramp steps (900/800/700 for the topbar gradient, 500/400,
and 50) are derived in `public/js/theme.js` by scaling lightness in HSL, so
hue and saturation survive and the brand still looks like itself at every step.
Optional: `favicon` (when the tab icon differs from the logo), `wideLogo`
(`true`/`false` to override the wordmark measurement), `key` (the CSS
`data-theme` value; defaults to a slug of the title).

A String — `"theme": "retail"` — instead names a preset in theme.js. Presets
predate the object form and are kept for the extra polish they can carry (a
multi-resolution favicon set). Anything unusable falls back to the default
noobly teal rather than half-branding the app.

### `home` — the space's landing page

`theme.home` names the document the space opens on, space-relative. It is what
lets several spaces sit on ONE content root and still open on different pages —
the Retail and Engineering spaces are both rooted at
`knowledge-content/engineering` and open `.retail.md` / `.engineering.md`. It
lives beside the brand so a landing page and the palette it was designed for
cannot drift apart. Resolution order is `theme.home` → a top-level `"home"` on
the space record (an older spelling) → `.home.md` → `home.md`, and the first
that EXISTS wins — so naming a page that has not been created yet degrades to
the normal home file rather than to a blank screen. Implemented in
`app.spaceHomeCandidates()`; `navigationcontroller.loadFolderHomeContent()`
uses it for the space root and plain `.home.md` / `home.md` for every folder
below it.

A dot-prefixed name keeps the landing page out of the file tree, which is
usually what you want. Note that unlike `.home.md` it is not currently
search-indexed (`isSearchIndexablePath` in `fileWatcher.js` exempts `.home.md`
by name).

## Space Types

- **project**: Dedicated to a specific project or initiative
- **team**: Shared team workspace
- **workflow**: Workflow automation and orchestration
- **documentation**: Knowledge base and documentation
- **archive**: Archived or historical content
- **temporary**: Short-lived spaces for specific purposes

## Visibility Levels

- **public**: Accessible to all users
- **team**: Accessible to organization members
- **private**: Accessible only to specific allowed users

## Permission Levels

- **read-only**: Users can view but not modify
- **read-write**: Users can view and modify

## API Endpoints

### List Spaces

```bash
GET /api/spaces?type=project&visibility=team&archived=false
```

Query parameters:
- `type` - Filter by space type
- `visibility` - Filter by visibility level
- `archived` - Filter by archived status (true/false)

Response:
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "id": 1,
      "name": "Default Project Space",
      "description": "Default space for projects",
      "type": "project",
      "visibility": "team",
      "permissions": "read-write",
      "allowedUsers": [],
      "configuration": {
        "filing": {
          "provider": "local",
          "baseDir": "../knowledge-content/engineering",
          "maxFileSize": 10485760,
          "allowedExtensions": ["*"]
        }
      },
      "createdAt": "2026-02-13T...",
      "createdBy": "admin@example.com",
      "updatedAt": "2026-02-13T...",
      "updatedBy": "admin@example.com",
      "metadata": {
        "archived": false
      }
    }
  ]
}
```

### Get Single Space

```bash
GET /api/spaces/:id
```

### Create Space

```bash
POST /api/spaces
Content-Type: application/json

{
  "name": "Q1 2026 Initiatives",
  "description": "Quarterly projects and workflows",
  "type": "project",
  "visibility": "team",
  "permissions": "read-write",
  "allowedUsers": ["user1@example.com", "user2@example.com"],
  "theme": "retail",
  "configuration": {
    "filing": {
      "provider": "local",
      "baseDir": "../knowledge-content/engineering",
      "maxFileSize": 10485760,
      "allowedExtensions": ["*"]
    },
    "allowedPaths": ["Solution Design/Distribution", "Standards"],
    "excludedPaths": ["Solution Design/Distribution/Technology"]
  }
}
```

`allowedPaths` / `excludedPaths` are optional. They curate which subtrees of
`baseDir` the space exposes, so two spaces can be different lenses over one
content root. Matching is prefix/subtree — see
`src/shared/spaces/spaceVisibility.js`.

### Update Space

```bash
PUT /api/spaces/:id
Content-Type: application/json

{
  "description": "Updated description",
  "allowedUsers": ["user1@example.com", "user2@example.com", "user3@example.com"],
  "theme": "noobly"
}
```

### Delete Space

```bash
DELETE /api/spaces/:id
```

### Archive Space (Soft Delete)

```bash
POST /api/spaces/:id/archive
```

Soft deletes a space (marks as archived without removing data).

### Restore Archived Space

```bash
POST /api/spaces/:id/restore
```

### Add User to Space

```bash
POST /api/spaces/:id/users/:userId
```

### Remove User from Space

```bash
DELETE /api/spaces/:id/users/:userId
```

## Usage Examples

### Creating a Project Space

```javascript
const spaceManager = app.get('spaceManager');

const projectSpace = await spaceManager.createSpace({
  name: 'Mobile App Redesign',
  description: 'Q1 2026 mobile app redesign project',
  type: 'project',
  visibility: 'team',
  permissions: 'read-write',
  configuration: {
    budget: 50000,
    timeline: '12 weeks',
    team: ['designer1', 'developer1', 'qa1'],
    deliverables: ['wireframes', 'prototypes', 'final-design']
  }
}, userId);
```

### Managing Space Access

```javascript
// Add user to space
await spaceManager.addUserToSpace(spaceId, userId);

// Remove user from space
await spaceManager.removeUserFromSpace(spaceId, userId);

// Check user access
const hasAccess = spaceManager.hasUserAccess(spaceId, userId);

// Get user's spaces
const userSpaces = spaceManager.getSpacesForUser(userId);
```

### Archiving and Restoring

```javascript
// Archive a space
await spaceManager.archiveSpace(spaceId, userId);

// Restore archived space
await spaceManager.restoreSpace(spaceId, userId);

// Get archived spaces
const archivedSpaces = spaceManager.getAllSpaces({ archived: true });
```

## Integration with Wiki Module

The Wiki module can be updated to use the centralized Spaces system:

1. Wiki spaces become references to Datasources spaces
2. Each wiki document stores a reference to its space ID
3. Permissions are inherited from the Spaces system
4. Cross-module space queries become possible

## Storage

Spaces are persisted to:
```
.application/spaces.json
```

Format:
```json
[
  {
    "id": 1,
    "name": "Space Name",
    ...
  }
]
```

## Security Considerations

1. **Authentication**: All write operations require authentication
2. **Authorization**: Users can only modify spaces they created or are admin
3. **Access Control**: Visibility and allowedUsers list enforces access
4. **Audit Trail**: createdBy/updatedBy track all modifications
5. **Soft Deletes**: Archive preserves data for recovery

## Future Enhancements

- **Role-Based Access Control**: More granular permission levels
- **Space Hierarchy**: Parent-child space relationships
- **Permissions Inheritance**: Child spaces inherit parent permissions
- **Space Templates**: Pre-configured space templates
- **Quota Management**: Storage and resource limits per space
- **Audit Logging**: Full audit trail of all space operations
- **Space Collaboration**: Real-time collaboration features
- **Integration with Workflows**: Bind workflows to spaces

## See Also

- [Datasources Module Documentation](./README.md)
- [Wiki Module Documentation](../wiki/README.md)
- [API Reference](../../docs/API-Reference.md)
