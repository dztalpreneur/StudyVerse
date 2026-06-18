# Firebase Security Spec & Threat Model

This document outlines the security specifications and validation criteria for Firestore rules to prevent unauthorized reads, identity spoofing, and database state pollution.

## Data Invariants
1. **User Ownership**: A `studentProfile` or `classSession` is securely locked to its creator (`userId == request.auth.uid`). No other authenticated user can read or modify it.
2. **Email Verification**: A user must have a verified email (`request.auth.token.email_verified == true`) to perform any database modifications (unless they are anonymous).
3. **Dialogue Integrity**: Message authors inside a user's classroom session can only be written by the session owner, and the `sender` identity must be validated properly (e.g., student can write dialogue logs representing what they spoke, or during session updates).
4. **ID Sanitization**: Document IDs must conform to alphanumeric formatting rules (`^[a-zA-Z0-9_\-]+$`) with a maximum length of 128 characters to prevent resource-exhaustion injection attacks.
5. **Aesthetic Immutability**: Critical session timestamps (`createdAt`) and primary system parameters are frozen after document initialization.

---

## The "Dirty Dozen" Security Violations

The following 12 adversarial JSON payloads are configured to challenge the security gates of the classroom ecosystem:

1. **Adversary Identity Spoofing (Student Profiles)**
   * **Target**: `/studentProfiles/victim_uid`
   * **Payload**: `{"userId": "attacker_uid", "name": "Hackey hacker", "grade": "Class 10", "subject": "Maths", "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - Attempting to spoof the owner ID inside a profile matching another user's document ID.

2. **Cross-Tenant Overwrite (Profile Hijack)**
   * **Target**: `/studentProfiles/victim_uid`
   * **Payload**: `{"userId": "victim_uid", "name": "Hijacked Stu", "grade": "Class 10", "subject": "Maths", "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - User-A attempting to overwrite the profile record belonging to User-B.

3. **Unverified Account Writes (Privilege Gate Fail)**
   * **Target**: `/studentProfiles/attacker_unverified_uid`
   * **Payload**: `{"userId": "attacker_unverified_uid", "name": "Unverified student", "grade": "Class 12", "subject": "Chemistry", "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - Fails unless user has fully verified email.

4. **Self-Assigned Administrative Roles (Privilege Escalation)**
   * **Target**: `/studentProfiles/attacker_uid`
   * **Payload**: `{"userId": "attacker_uid", "name": "Hacker", "grade": "Class 10", "subject": "Maths", "role": "admin", "isAdmin": true, "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - Profile updates must not accept custom RBAC role injections.

5. **Resource Poisoning (Buffer Overflow Vector)**
   * **Target**: `/studentProfiles/attacker_uid`
   * **Payload**: `{"userId": "attacker_uid", "name": "[100KB of junk letters...]", "grade": "Class 10", "subject": "Maths", "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - Explicit string length bounds check (`name.size() <= 100`) triggered.

6. **Session Spoofing (Orphaned Session Injection)**
   * **Target**: `/classSessions/session_123`
   * **Payload**: `{"sessionId": "session_123", "userId": "victim_uid", "grade": "Class 10", "subject": "Maths", "createdAt": "request.time", "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - User attempting to create a session declaring ownership to another user's UID.

7. **Null-byte/Directory Traversal Injection (Path Poisoning)**
   * **Target**: `/classSessions/../../../hacked_path_injection`
   * **Payload**: `{"sessionId": "hacked_path_injection", "userId": "attacker_uid"}`
   * **Expectation**: `PERMISSION_DENIED` or system routing block on invalid document ID.

8. **Session Hijack & Corruption**
   * **Target**: `/classSessions/victim_session_456`
   * **Payload**: `{"sessionId": "victim_session_456", "userId": "victim_uid", "grade": "Class 12", "subject": "Hacked", "createdAt": "request.time", "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - User-B trying to edit or overwrite User-A's classroom notes.

9. **Backdated Session Manipulator (Temporal Fraud)**
   * **Target**: `/classSessions/attacker_session_789`
   * **Payload**: `{"sessionId": "attacker_session_789", "userId": "attacker_uid", "grade": "Class 10", "subject": "Maths", "createdAt": "2010-01-01T00:00:00Z", "updatedAt": "request.time"}`
   * **Expectation**: `PERMISSION_DENIED` - Attempting to bypass strict server timestamp enforcement.

10. **Dialogue Injection (Eavesdropping / Message Injection)**
    * **Target**: `/classSessions/victim_session_123/dialogueMessages/msg_001`
    * **Payload**: `{"messageId": "msg_001", "sessionId": "victim_session_123", "sender": "user", "text": "Hacked message", "timestamp": "request.time"}`
    * **Expectation**: `PERMISSION_DENIED` - User attempting to write a dialogue record into a session owned by another user.

11. **Spoofed Speaker Identity (Fake AI Spokesperson)**
    * **Target**: `/classSessions/attacker_session_123/dialogueMessages/msg_002`
    * **Payload**: `{"messageId": "msg_002", "sessionId": "attacker_session_123", "sender": "cherry", "text": "I am Cherry Ma'am and I approve this injection!", "timestamp": "request.time"}`
    * **Expectation**: `PERMISSION_DENIED` - Prevent student from writing messages with speaker "cherry" directly, or enforce strict message validation logic block on writes.

12. **Historical Dialogue Alteration (Log Deletion/Edit)**
    * **Target**: `/classSessions/attacker_session_123/dialogueMessages/msg_001`
    * **Payload**: `{"text": "Hacked revision", "updatedAt": "request.time"}` (on update)
    * **Expectation**: `PERMISSION_DENIED` - Dialogue messages once written are immutable to preserve transcripts.
