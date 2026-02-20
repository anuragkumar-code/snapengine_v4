# Album Platform API Documentation

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** JWT Bearer Token (include in `Authorization` header)

---

## 🔐 Authentication

### Register
```
POST /auth/register
Body: { email, password, firstName, lastName }
Response: { user, accessToken, refreshToken }
```

### Login
```
POST /auth/login
Body: { email, password }
Response: { user, accessToken, refreshToken }
```

### Refresh Token
```
POST /auth/refresh
Body: { refreshToken }
Response: { accessToken, refreshToken }
```

### Request Password Reset
```
POST /auth/password-reset/request
Body: { email }
Response: 200 (always, prevents enumeration)
```

### Reset Password
```
POST /auth/password-reset/confirm
Body: { token, newPassword }
Response: 204
```

---

## 👤 User Management

### Get Own Profile
```
GET /users/me
Auth: Required
Response: { user }
```

### Update Own Profile
```
PATCH /users/me
Auth: Required
Body: { firstName?, lastName?, bio?, preferences? }
Response: { user }
```

### Change Password
```
POST /users/me/password
Auth: Required
Body: { currentPassword, newPassword }
Response: 204
```

### Upload Avatar
```
POST /users/me/avatar
Auth: Required
Content-Type: multipart/form-data
Body: { avatar: <file> }
Response: { user }
```

### Get User by ID
```
GET /users/:id
Auth: Optional (more data if authenticated)
Response: { user }
```

### List Users (Admin)
```
GET /users?page=1&limit=20
Auth: Required (admin only)
Response: { users[], pagination }
```

---

## 📁 Albums

### List Albums
```
GET /albums?page=1&limit=20&ownerId=uuid
Auth: Optional (public + member albums if authenticated)
Response: { albums[], pagination }
```

### Create Album
```
POST /albums
Auth: Required
Body: { name, description?, date?, isPublic?, metadata? }
Response: { album }
```

### Get Album
```
GET /albums/:albumId
Auth: Optional (public access for public albums)
Response: { album }
```

### Get Album by Public Token
```
GET /albums/public/:token
Auth: None
Response: { album }
```

### Update Album
```
PATCH /albums/:albumId
Auth: Required (admin+ role)
Body: { name?, description?, date?, isPublic? }
Response: { album }
```

### Delete Album (Soft)
```
DELETE /albums/:albumId
Auth: Required (owner only)
Response: 204
```

### Restore Album
```
POST /albums/:albumId/restore
Auth: Required (owner or system admin)
Response: { album }
```

### Get Activity Log
```
GET /albums/:albumId/activity?page=1&limit=20&actorId=uuid&type=album.created
Auth: Required (any member)
Response: { logs[], pagination }
```

---

## 👥 Album Members

### List Members
```
GET /albums/:albumId/members?page=1&limit=20
Auth: Required (any member)
Response: { members[], pagination }
```

### Add Member
```
POST /albums/:albumId/members
Auth: Required (admin+ role)
Body: { userId, role: 'viewer'|'contributor'|'admin' }
Response: { member }
```

### Remove Member
```
DELETE /albums/:albumId/members/:userId
Auth: Required (self-removal or admin+)
Response: 204
```

### Change Member Role
```
PATCH /albums/:albumId/members/:userId/role
Auth: Required (admin+ role)
Body: { role: 'viewer'|'contributor'|'admin' }
Response: { member }
```

### Get Effective Permissions
```
GET /albums/:albumId/members/:userId/permissions
Auth: Required (any member)
Response: { permissions: { role, basePermissions[], overrides[], effectivePermissions[] } }
```

### Set Permission Override
```
PUT /albums/:albumId/members/:userId/permissions/overrides
Auth: Required (admin+ role)
Body: { action: 'album:edit', granted: true, reason?: 'string' }
Response: { override }
```

### Remove Permission Override
```
DELETE /albums/:albumId/members/:userId/permissions/overrides/:action
Auth: Required (admin+ role)
Response: 204
```

---

## 💌 Invitations

### List Invitations (Album)
```
GET /albums/:albumId/invitations?page=1&limit=20
Auth: Required (admin+ role)
Response: { invitations[], pagination }
```

### Create Invitation
```
POST /albums/:albumId/invitations
Auth: Required (contributor+ role)
Body: { 
  invitedEmail?, 
  invitedRole: 'viewer'|'contributor'|'admin', 
  note?, 
  maxUses?: 1,
  expiresInMs?: 604800000 
}
Response: { invitation, token: 'raw-token-string' }
```

### Revoke Invitation
```
DELETE /albums/:albumId/invitations/:invitationId
Auth: Required (admin+ role)
Response: 204
```

### Preview Invitation (Public)
```
GET /invitations/:token
Auth: None
Response: { invitation, album, invitedBy }
```

### Accept Invitation
```
POST /invitations/:token/accept
Auth: Required
Response: { member }
```

### Decline Invitation
```
POST /invitations/:token/decline
Auth: Required
Response: 200
```

---

## 📸 Photos

### List Photos (Album)
```
GET /albums/:albumId/photos?page=1&limit=20&status=ready&tags[]=sunset
Auth: Optional (visibility-filtered)
Response: { photos[], pagination }
```

### Upload Photo
```
POST /albums/:albumId/photos
Auth: Required (contributor+ role)
Content-Type: multipart/form-data
Body: { photo: <file>, metadata?: {} }
Response: { photo }
```

### Get Photo
```
GET /photos/:photoId
Auth: Optional (visibility check applied)
Response: { photo }
```

### Update Photo Visibility
```
PATCH /photos/:photoId/visibility
Auth: Required (uploader or album admin+)
Body: { 
  visibilityType: 'album_default'|'restricted'|'hidden',
  allowedUserIds?: ['uuid1', 'uuid2']  (required if restricted)
}
Response: { photo }
```

### Delete Photo (Soft)
```
DELETE /photos/:photoId
Auth: Required (uploader or album admin+)
Response: 204
```

### Restore Photo
```
POST /photos/:photoId/restore
Auth: Required (uploader or album owner)
Response: { photo }
```

---

## 🏷️ Tags

### Tag Autocomplete
```
GET /tags/autocomplete?q=sun
Auth: None
Response: { tags: [{ id, name, slug, usageCount }] }
```

### Popular Tags
```
GET /tags/popular
Auth: None
Response: { tags: [{ id, name, slug, usageCount }] }
```

### Search Photos by Tag
```
GET /tags/:slug/photos?page=1&limit=20&albumId=uuid
Auth: Optional (visibility-filtered)
Query: albumId (optional - if omitted, searches across all albums)
Response: { photos[], tag, pagination }
```

### Add Tags to Photo
```
POST /photos/:photoId/tags
Auth: Required (uploader or album contributor+)
Body: { tags: ['sunset', 'beach', 'vacation'] }
Response: { tags[] }
```

### Remove Tag from Photo
```
DELETE /photos/:photoId/tags
Auth: Required (uploader or album contributor+)
Body: { tagId: 'uuid' }
Response: 204
```

---

## 💬 Comments

### List Comments (Photo)
```
GET /photos/:photoId/comments?page=1&limit=20
Auth: Optional (visibility inherits from photo)
Response: { comments[] (threaded), pagination }
```

### Add Comment
```
POST /photos/:photoId/comments
Auth: Required (album contributor+)
Body: { content, parentId?: 'uuid' }
Response: { comment }
```

### Edit Comment
```
PATCH /comments/:commentId
Auth: Required (author only, within 5 min)
Body: { content }
Response: { comment }
```

### Delete Comment
```
DELETE /comments/:commentId
Auth: Required (author, uploader, or album admin+)
Response: 204
```

---

## 🗑️ Trash Management

### List Trashed Albums
```
GET /trash/albums?page=1&limit=20
Auth: Required
Response: { albums[], pagination }
```

### List Trashed Photos
```
GET /trash/photos?page=1&limit=20&albumId=uuid
Auth: Required
Query: albumId (optional - filter by album)
Response: { photos[], pagination }
```

### Empty Trash
```
DELETE /trash/:type  (type = 'albums' or 'photos')
Auth: Required
Response: { deletedCount }
```

---

## 🔍 Search

### Unified Search
```
GET /search?q=sunset&context=albums&page=1&limit=20
GET /search?q=sunset&context=photos&albumId=uuid
GET /search?q=sunset&context=photos  (cross-album)

Auth: Optional (enriched results if authenticated)

Query Parameters:
  - q: search query string
  - context: 'albums' | 'photos' (default: 'albums')
  - albumId: (optional) for photo search within specific album
  - dateFrom: ISO date (optional)
  - dateTo: ISO date (optional)
  - page, limit: pagination

Response: { results[], query, context, albumId?, pagination }
```

**Search Context Behavior:**

**context=albums:**
- Searches: album name, description, owner name
- Returns: albums user can access (public + member albums)

**context=photos + albumId:**
- Searches: photo filename, tags (within specific album)
- Returns: photos within album (visibility-filtered)

**context=photos (no albumId):**
- Searches: photo filename, tags (across all albums)
- Returns: photos from all accessible albums (public visibility only for simplicity)

---

## 🏥 System

### Health Check
```
GET /health
Auth: None
Response: { 
  status: 'ok', 
  services: { database, redis, queues }
}
```

---

## 📊 Response Format

### Success
```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "must be a valid email" }
    ]
  }
}
```

---

## 🔑 Permission Roles

### System Roles
- `user` - Regular user (default)
- `admin` - System administrator (full access)

### Album Roles (Hierarchical)
- `viewer` - Can view photos (if visibility allows)
- `contributor` - Can upload photos, add comments
- `admin` - Can manage members, edit album settings
- `owner` - Full control (cannot be removed, only transferred)

### Permission Overrides
Album admins can grant/deny specific actions for individual members, overriding their base role.

---

## 🔒 Photo Visibility Types

- `album_default` - Inherits album permissions (visible to all album members)
- `restricted` - Only visible to specific users (allowlist)
- `hidden` - Blocked from all members except owner + uploader

---

## 📝 Notes

- All timestamps are in ISO 8601 format
- All IDs are UUIDs (v4)
- Pagination: default limit=20, max=100
- Rate limits: 10 req/15min for auth endpoints
- File upload: max 10MB for photos
- Soft deletes: items remain in trash until permanently deleted

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DB/Redis credentials

# 3. Run migrations
npx sequelize-cli db:migrate

# 4. Start server
npm run dev
# → Listening on http://localhost:3000

# 5. Test health check
curl http://localhost:3000/health
```