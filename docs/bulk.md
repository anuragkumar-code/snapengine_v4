# Bulk Operations Guide

## Overview

The platform supports efficient bulk operations for photos to improve user experience when managing large photo collections.

---

## 🚀 Features

### 1. **Bulk Photo Upload**
Upload 1-20 photos in a single request.

### 2. **Bulk Photo Delete**
Delete up to 100 photos at once (move to trash).

### 3. **Bulk Photo Visibility Change**
Update visibility settings for up to 100 photos simultaneously.

### 4. **Album Cover Photo**
Set any photo as the album cover.

---

## 📸 Bulk Photo Upload

### **Endpoint**
```
POST /api/v1/albums/:albumId/photos
Content-Type: multipart/form-data
```

### **Single File Upload**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "photo=@sunset.jpg" \
  http://localhost:3000/api/v1/albums/ALBUM_ID/photos
```

### **Bulk Upload (Multiple Files)**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "photos=@photo1.jpg" \
  -F "photos=@photo2.jpg" \
  -F "photos=@photo3.jpg" \
  http://localhost:3000/api/v1/albums/ALBUM_ID/photos
```

### **JavaScript Example (Frontend)**
```javascript
const formData = new FormData();

// Bulk upload
files.forEach(file => {
  formData.append('photos', file);
});

const response = await fetch(`/api/v1/albums/${albumId}/photos`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});

const result = await response.json();
// result.data = { uploaded: [...], failed: [...] }
```

### **Response (All Success)**
```json
{
  "success": true,
  "data": {
    "uploaded": [
      {
        "id": "uuid1",
        "originalFilename": "photo1.jpg",
        "status": "pending",
        "fileUrl": "...",
        "thumbnailUrl": null
      },
      {
        "id": "uuid2",
        "originalFilename": "photo2.jpg",
        "status": "pending",
        "fileUrl": "...",
        "thumbnailUrl": null
      }
    ]
  },
  "message": "2 photos uploaded successfully. Processing in background."
}
```

### **Response (Partial Success)**
```json
{
  "success": true,
  "data": {
    "uploaded": [
      { "id": "uuid1", "originalFilename": "photo1.jpg", ... }
    ],
    "failed": [
      {
        "filename": "corrupted.jpg",
        "error": "Invalid image format",
        "status": "error"
      }
    ]
  },
  "message": "1 photo(s) uploaded, 1 failed. Processing in background."
}
```

### **Limits**
- **Max files per request:** 20
- **Max file size:** 10MB per file
- **Total max size per request:** 200MB (20 × 10MB)
- **Allowed types:** JPEG, PNG, GIF, WebP

### **Processing Flow**
```
1. Upload completes (2-5 seconds)
   → Photos saved with status=PENDING
   
2. Queue jobs dispatched
   → Thumbnail generation happens async
   
3. Poll for status updates
   GET /albums/:albumId/photos?status=processing
   
4. Photos become READY one by one
   → Thumbnails available
```

### **Frontend UX Pattern**
```javascript
// 1. Upload
const { uploaded } = await uploadPhotos(files);

// 2. Show immediate feedback
showToast(`${uploaded.length} photos uploaded! Processing...`);

// 3. Poll for completion
const interval = setInterval(async () => {
  const photos = await fetchPhotos(albumId);
  const processing = photos.filter(p => p.status === 'processing');
  
  updateProgress(`Processing: ${processing.length} remaining`);
  
  if (processing.length === 0) {
    clearInterval(interval);
    showToast('All photos ready!');
  }
}, 2000); // Poll every 2 seconds
```

---

## 🗑️ Bulk Photo Delete

### **Endpoint**
```
POST /api/v1/albums/:albumId/photos/bulk-delete
Content-Type: application/json
```

### **Request**
```json
{
  "photoIds": [
    "uuid1",
    "uuid2",
    "uuid3"
  ]
}
```

### **Response (Success)**
```json
{
  "success": true,
  "data": {
    "deletedCount": 3,
    "photoIds": ["uuid1", "uuid2", "uuid3"]
  },
  "message": "3 photo(s) moved to trash"
}
```

### **Response (Permission Error)**
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Permission denied for 1 photo(s)",
    "details": {
      "deniedPhotoIds": ["uuid2"]
    }
  }
}
```

### **Limits**
- **Max photos per request:** 100
- **Permission required:** Uploader OR Album Admin+

### **Behavior**
- **Atomic operation:** All photos deleted together or none
- **Soft delete:** Photos moved to trash (recoverable)
- **Activity logged:** Single bulk delete event

### **Example**
```javascript
const deletePhotos = async (albumId, photoIds) => {
  const response = await fetch(
    `/api/v1/albums/${albumId}/photos/bulk-delete`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ photoIds })
    }
  );
  
  return response.json();
};

// Usage
await deletePhotos(albumId, selectedPhotoIds);
```

---

## 🔒 Bulk Visibility Change

### **Endpoint**
```
POST /api/v1/albums/:albumId/photos/bulk-visibility
Content-Type: application/json
```

### **Request (Make Restricted)**
```json
{
  "photoIds": ["uuid1", "uuid2", "uuid3"],
  "visibilityType": "restricted",
  "allowedUserIds": ["userA", "userB"]
}
```

### **Request (Make Default)**
```json
{
  "photoIds": ["uuid1", "uuid2"],
  "visibilityType": "album_default"
}
```

### **Request (Hide from All)**
```json
{
  "photoIds": ["uuid1"],
  "visibilityType": "hidden"
}
```

### **Response**
```json
{
  "success": true,
  "data": {
    "updatedCount": 3,
    "photos": [
      {
        "id": "uuid1",
        "visibilityType": "restricted",
        "visibilityAllowlist": [...]
      },
      ...
    ]
  },
  "message": "Visibility updated for 3 photo(s)"
}
```

### **Limits**
- **Max photos per request:** 100
- **Permission required:** Uploader OR Album Admin+

### **Validation Rules**
- All `allowedUserIds` must be album members
- `allowedUserIds` required if `visibilityType = restricted`
- `allowedUserIds` forbidden if `visibilityType != restricted`

### **Example**
```javascript
const changeVisibility = async (photoIds, type, allowedUsers = []) => {
  const response = await fetch(
    `/api/v1/albums/${albumId}/photos/bulk-visibility`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        photoIds,
        visibilityType: type,
        allowedUserIds: allowedUsers
      })
    }
  );
  
  return response.json();
};

// Make photos restricted to family only
await changeVisibility(
  selectedPhotoIds, 
  'restricted', 
  familyMemberIds
);
```

---

## 🖼️ Set Album Cover Photo

### **Endpoint**
```
PATCH /api/v1/albums/:albumId
Content-Type: application/json
```

### **Request**
```json
{
  "coverPhotoId": "photo-uuid"
}
```

### **Response**
```json
{
  "success": true,
  "data": {
    "album": {
      "id": "album-uuid",
      "name": "Summer Vacation",
      "coverPhotoId": "photo-uuid",
      ...
    }
  },
  "message": "Album updated"
}
```

### **Validation**
- Photo must exist
- Photo must belong to this album
- Photo must have `status = ready` (fully processed)
- User must be Album Admin+

### **Remove Cover Photo**
```json
{
  "coverPhotoId": null
}
```

### **Example**
```javascript
const setCoverPhoto = async (albumId, photoId) => {
  const response = await fetch(`/api/v1/albums/${albumId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ coverPhotoId: photoId })
  });
  
  return response.json();
};
```

---

## ⚡ Performance Tips

### **Bulk Upload**
1. **Batch large collections:**
   - Don't upload 100 files at once
   - Upload in batches of 20
   - Show progress: "Batch 3/5 (60%)"

2. **Pre-validate on frontend:**
   - Check file types before upload
   - Check file sizes before upload
   - Show errors immediately

3. **Show processing status:**
   - Poll `/photos?status=processing` every 2-3 seconds
   - Update progress bar
   - Enable navigation (don't block user)

### **Bulk Delete**
1. **Confirm before deleting:**
   - Show modal: "Delete 15 photos?"
   - Atomic operation = instant response

2. **Optimistic UI updates:**
   - Remove from UI immediately
   - Revert if request fails

### **Bulk Visibility**
1. **Pre-select members:**
   - Load album members list first
   - Show checkboxes for selection
   - Validate before sending

---

## 🔒 Security Considerations

### **Upload**
- ✅ Each file validated individually (type, size)
- ✅ Album permission checked once
- ✅ Rate limiting counts each file separately
- ✅ Max 20 files prevents memory exhaustion

### **Delete**
- ✅ Atomic permission check (all or nothing)
- ✅ Transaction ensures consistency
- ✅ Soft delete (recoverable)

### **Visibility**
- ✅ All photos validated to belong to album
- ✅ All allowed users validated to be members
- ✅ Atomic operation

---

## 🐛 Error Handling

### **Common Errors**

**Too many files:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Cannot upload more than 20 files at once"
  }
}
```

**Photo not in album:**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Photos not found in album: uuid1, uuid2"
  }
}
```

**Permission denied:**
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Permission denied for 2 photo(s)",
    "details": {
      "deniedPhotoIds": ["uuid1", "uuid2"]
    }
  }
}
```

**Invalid users in allowlist:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Users not found in album: userX, userY"
  }
}
```

---

## 📊 Database Impact

### **Bulk Insert (Upload)**
```sql
-- Bad (N queries)
INSERT INTO photos VALUES (...);
INSERT INTO photos VALUES (...);
INSERT INTO photos VALUES (...);

-- Good (1 query) - what we use
INSERT INTO photos VALUES (...), (...), (...);
```

### **Bulk Update (Delete)**
```sql
-- Optimized single query
UPDATE photos 
SET deleted_at = NOW() 
WHERE id IN ('uuid1', 'uuid2', 'uuid3');
```

### **Bulk Visibility Update**
```sql
-- Transaction ensures atomicity
BEGIN;
  UPDATE photos SET visibility_type = 'restricted' WHERE id IN (...);
  DELETE FROM photo_visibilities WHERE photo_id IN (...);
  INSERT INTO photo_visibilities VALUES (...), (...), (...);
COMMIT;
```

---

## ✅ Best Practices

1. **Always validate on frontend first**
   - File types, sizes, count
   - Show errors before upload

2. **Use optimistic UI updates**
   - Update UI immediately
   - Revert if request fails

3. **Show clear progress indicators**
   - "Uploading 3/20..."
   - "Processing thumbnails..."
   - "5 photos ready"

4. **Handle partial failures gracefully**
   - Upload: Show which files succeeded/failed
   - Delete/Visibility: All-or-nothing (no partials)

5. **Batch large operations**
   - Don't upload 100 files at once
   - Split into batches of 20

6. **Enable background processing**
   - Don't block the UI
   - Let users navigate away
   - Show completion notification

---

## 🎯 Quick Reference

| Operation | Endpoint | Max Items | Atomic? | Permission |
|-----------|----------|-----------|---------|------------|
| Bulk Upload | `POST /:albumId/photos` | 20 files | No (partial OK) | Contributor+ |
| Bulk Delete | `POST /:albumId/photos/bulk-delete` | 100 | Yes | Uploader or Admin+ |
| Bulk Visibility | `POST /:albumId/photos/bulk-visibility` | 100 | Yes | Uploader or Admin+ |
| Cover Photo | `PATCH /albums/:albumId` | 1 | N/A | Admin+ |