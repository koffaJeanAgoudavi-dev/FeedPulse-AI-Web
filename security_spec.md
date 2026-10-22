# FeedPulse AI Security Specification & Test Harness

## 1. Data Invariants
1. **User Invariant**: A user document at `/users/{userId}` can only be created or modified by an authenticated user where `request.auth.uid == userId`.
2. **Self-Assigned Role Invariant**: Normal users cannot grant themselves `admin` role or modify privilege fields.
3. **Favorite Invariant**: A favorite at `/users/{userId}/favorites/{favoriteId}` strictly belongs to `userId`. `resource.data.userId` and path `userId` must match `request.auth.uid`.
4. **Immutability Invariant**: `createdAt` and `userId` cannot be changed after initial document creation.
5. **Timestamp Integrity**: `createdAt` on create must equal `request.time`.
6. **Bounds & Type Integrity**: String lengths must strictly adhere to `firebase-blueprint.json` bounds (`maxLength`).

## 2. The "Dirty Dozen" Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: Attempting to read another user's private data without auth token.
2. **Identity Spoofing on User Create**: Setting `id: "victim_uid"` while authenticated as `attacker_uid`.
3. **Self-Escalation to Admin**: Setting `role: "admin"` on profile creation.
4. **Shadow Field Injection**: Injecting unauthorized `isSuperUser: true` into a profile write.
5. **Cross-Tenant Favorite Creation**: Authenticated user `A` creating a favorite under `/users/B/favorites/fav1`.
6. **Orphaned Favorite Spoofing**: User `A` creating a favorite with `userId: "B"` inside their own subcollection.
7. **Favorite Infiltration via List Query**: Attempting blanket query across all favorites without checking `userId == request.auth.uid`.
8. **Malicious ID Buffer Overflow**: Passing a 2KB string as `favoriteId` or `userId`.
9. **Fake Timestamp Tampering**: Passing a client timestamp 10 years in the future instead of `request.time`.
10. **Favorite Immutability Breach**: Updating `userId` or `articleId` after a favorite is created.
11. **Excessive String Payload**: Storing a 50KB payload inside `articleTitle` (limit: 256 chars).
12. **Unauthorized Favorite Deletion**: User `B` attempting to delete a favorite owned by User `A`.

## 3. Test Runner Specification
The test suite validates that all 12 payloads are blocked with `PERMISSION_DENIED`.
