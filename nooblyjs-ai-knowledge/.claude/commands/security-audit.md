# Security Audit

Perform a comprehensive security audit of the noobly Core codebase to identify vulnerabilities, misconfigurations, and security best practice violations.

## What This Command Does

This command helps you:
1. Identify common security vulnerabilities (OWASP Top 10)
2. Detect hardcoded secrets and credentials
3. Check authentication and authorization implementation
4. Review input validation and sanitization
5. Verify secure dependency versions
6. Check for unsafe code patterns
7. Audit API endpoint security
8. Review data protection practices
9. Identify privilege escalation risks
10. Check for configuration security issues

## Security Checklist

### Critical Security Issues

- [ ] **Hardcoded Secrets**: Search for API keys, passwords, credentials in code
- [ ] **SQL Injection**: Check for unsanitized database queries
- [ ] **XSS (Cross-Site Scripting)**: Verify HTML/JavaScript sanitization
- [ ] **Command Injection**: Check for unsafe child_process or shell execution
- [ ] **Path Traversal**: Verify file operations validate paths
- [ ] **Insecure Deserialization**: Check for unsafe JSON/object parsing
- [ ] **Unsafe Dependencies**: Check for known vulnerable packages

### High Priority Security Issues

- [ ] **Authentication Bypass**: Verify auth middleware is properly applied
- [ ] **CSRF Protection**: Check for CSRF tokens on state-changing operations
- [ ] **Rate Limiting**: Verify rate limiting on login and API endpoints
- [ ] **CORS Misconfiguration**: Check CORS headers and allowed origins
- [ ] **Insecure Direct Object References (IDOR)**: Verify authorization checks
- [ ] **Broken Access Control**: Check role-based access control
- [ ] **SSL/TLS Configuration**: Verify HTTPS enforcement
- [ ] **Security Headers**: Check for missing security headers
- [ ] **Sensitive Data Exposure**: Verify PII is encrypted/protected
- [ ] **Weak Cryptography**: Check encryption algorithms are current

### Medium Priority Security Issues

- [ ] **Insufficient Input Validation**: Check all user inputs are validated
- [ ] **Missing Security Logging**: Verify security events are logged
- [ ] **Weak Password Policy**: Check password requirements
- [ ] **Session Security**: Verify session configuration
- [ ] **Error Handling**: Check for information disclosure in errors
- [ ] **API Documentation**: Verify security requirements are documented
- [ ] **Dependency Vulnerabilities**: Run npm audit
- [ ] **Code Injection**: Check for eval() or dynamic code execution

## Critical Audit Points

### 1. Secrets and Credentials

**What to check:**
- Environment variables properly configured
- No credentials in code
- No secrets in git history
- API keys have proper scope
- Database credentials not exposed

**Search patterns:**
```
- password\s*[:=]
- apiKey\s*[:=]
- secret\s*[:=]
- token\s*[:=]
- AWS_SECRET
- PRIVATE_KEY
- 'mongodb://[^:]+:[^@]+@'
```

**Files to check:**
```
- src/authservice/
- src/aiservice/
- app.js
- .env (should not be in repo)
- package.json (dependency versions)
```

### 2. Authentication & Authorization

**What to check in `src/authservice/`:**
- Password hashing algorithm (should use bcrypt, scrypt, or argon2)
- Token generation is cryptographically secure
- Session storage is secure
- Password reset tokens expire
- Logout properly invalidates tokens
- Login rate limiting exists
- Password requirements enforced

**Review files:**
```
- src/authservice/providers/authFile.js
- src/authservice/providers/authMemory.js
- src/authservice/providers/authPassport.js
- src/authservice/providers/authGoogle.js
- src/authservice/middleware/authenticate.js
```

**Code review checklist:**
```javascript
// ✅ Good: Password hashing
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(password, 10);

// ❌ Bad: Plain text or weak hashing
const hash = crypto.createHash('md5').update(password);
```

### 3. Input Validation

**What to check:**
- All user inputs are validated
- File uploads have size limits
- File uploads validate type/extension
- SQL/NoSQL queries use parameterized queries
- JSON parsing has limits
- URL parameters are validated
- Request body size is limited

**Search for:**
```
- Direct use of req.body, req.query, req.params
- Lack of validation middleware
- No type checking
- Missing sanitization
```

**Files to check:**
```
- src/*/routes/index.js (all service routes)
- app.js (middleware setup)
- src/dataservice/providers/
```

### 4. API Security

**What to check in routes:**
- API key middleware properly configured
- Authentication required on sensitive endpoints
- Authorization checks ownership/role
- Rate limiting on endpoints
- Proper HTTP methods (GET/POST/PUT/DELETE)
- CORS properly configured
- Input validation on all endpoints
- Error messages don't leak information

**Critical endpoints to review:**
```
POST /services/authservice/api/login - Auth required?
POST /services/authservice/api/register - Rate limited?
POST /services/dataservice/api/* - Authorization checks?
DELETE /services/dataservice/api/* - Ownership verified?
POST /services/filing/api/upload - File validation?
```

**Check for proper error handling:**
```javascript
// ❌ Bad: Leaks information
res.status(500).json({ error: err.message, stack: err.stack });

// ✅ Good: Generic error message
res.status(500).json({ error: 'Internal server error' });
```

### 5. Dependency Security

**What to check:**
```bash
# Run npm audit
npm audit

# Check for outdated packages
npm outdated

# Check for known vulnerabilities in dependencies
npm list
```

**High-risk dependencies to verify:**
```
- jsonwebtoken - Check version for known vulnerabilities
- passport - Verify latest version
- mongodb - Check for injection prevention
- bcrypt - For password hashing
- helmet - For security headers
- cors - For CORS configuration
- express-session - For session management
```

**Review package.json:**
```
- Check all versions are reasonable
- Remove unused dependencies
- Verify dev dependencies aren't bundled
- Check for typosquatting attacks (misspelled packages)
```

### 6. File Operations Security

**What to check in `src/filing/`:**
- Path traversal prevention
- File type validation
- File size limits
- Proper permissions
- Secure file deletion
- Temporary file cleanup

**Code review:**
```javascript
// ❌ Bad: Path traversal vulnerability
const filePath = path.join(baseDir, req.body.path);

// ✅ Good: Validate and normalize path
const sanitized = path.normalize(req.body.path);
if (!sanitized.startsWith('.') && !path.isAbsolute(sanitized)) {
  const filePath = path.join(baseDir, sanitized);
}
```

### 7. Data Protection

**What to check:**
- Sensitive data in logs?
- Database passwords exposed?
- API responses leak information?
- PII handling policies
- Data retention policies
- Secure data deletion

**Search for:**
```
- Logging of passwords, tokens, keys
- Storing plain text sensitive data
- No encryption of sensitive database fields
- Permanent data without retention policy
```

### 8. Configuration Security

**What to check in `app.js`:**
```javascript
// ✅ Good: Secure defaults
const options = {
  apiKeys: process.env.API_KEYS?.split(',') || [],
  requireApiKey: process.env.NODE_ENV === 'production',
  security: {
    apiKeyAuth: { requireApiKey: true },
    servicesAuth: { requireLogin: true }
  }
};

// ❌ Bad: Insecure defaults
const options = {
  requireApiKey: false,
  security: { servicesAuth: { requireLogin: false } }
};
```

**Check:**
- API key requirement in production
- Session security settings
- CORS configuration
- Security headers enabled
- HTTPS enforced
- Safe default values

### 9. Logging & Monitoring

**What to check:**
- Security events are logged
- Failed login attempts logged
- API key usage logged
- Unauthorized access attempts logged
- No sensitive data in logs
- Log retention policy
- Log access restricted

**Review:**
```
- src/logging/providers/ (check what can be logged)
- src/authservice/ (login/logout logging)
- src/*/routes/ (unauthorized access logging)
```

### 10. Third-Party Integrations

**AI Service (`src/aiservice/`):**
- API keys properly protected
- Prompt injection prevention
- Response validation
- Rate limiting
- API usage monitoring

**Cloud Storage (`src/filing/`):**
- AWS/GCP/Azure credentials secure
- Bucket policies reviewed
- ACLs properly configured
- Temporary credentials with expiration

**Database Connections:**
- Connection strings use variables
- SSL/TLS enabled for remote connections
- Credentials have minimal required permissions

## Automated Checks

### Run npm audit
```bash
# Check for known vulnerabilities
npm audit

# Fix automatically (use with caution)
npm audit fix
```

### Search for common vulnerabilities

```bash
# Search for hardcoded secrets
grep -r "password\s*[:=]" src/
grep -r "apiKey\s*[:=]" src/
grep -r "secret\s*[:=]" src/
grep -r "API_KEY\|SECRET_KEY\|PRIVATE_KEY" src/

# Search for eval or Function constructor
grep -r "eval(" src/
grep -r "Function(" src/

# Search for dangerous functions
grep -r "child_process.exec" src/
grep -r "require.*eval" src/

# Search for missing input validation
grep -r "req.body\." src/*/routes/

# Search for SQL/NoSQL injection risks
grep -r "query.*req\." src/
```

### Check middleware configuration
```bash
# Verify authentication middleware
grep -r "authMiddleware" src/*/routes/

# Check for missing cors configuration
grep -r "cors" src/

# Verify rate limiting
grep -r "rateLimit\|RateLimit" src/
```

## Security Testing Scenarios

### Test 1: Authentication Bypass
```
- Try accessing protected endpoints without token
- Try using expired tokens
- Try using invalid tokens
- Try modifying token contents
- Try accessing other users' data
```

### Test 2: Input Validation
```
- Send oversized payloads
- Send malformed JSON
- Send SQL injection attempts: ' OR '1'='1
- Send XSS payloads: <script>alert('xss')</script>
- Send path traversal: ../../etc/passwd
```

### Test 3: API Key Security
```
- Try API requests without key
- Try using invalid keys
- Try using expired keys
- Try modifying key in request
```

### Test 4: File Operations
```
- Try uploading large files
- Try uploading executable files
- Try accessing files via path traversal
- Try overwriting existing files
```

### Test 5: Rate Limiting
```
- Try rapid login attempts
- Try bulk data requests
- Check if rate limiting works
```

## Files to Review

### Priority 1 (Critical)
```
- src/authservice/middleware/*.js
- src/authservice/providers/*.js
- app.js (security configuration)
- index.js (API key middleware setup)
```

### Priority 2 (High)
```
- src/*/routes/index.js (all API endpoints)
- src/filing/providers/*.js (file operations)
- src/dataservice/providers/*.js (data access)
```

### Priority 3 (Medium)
```
- src/logging/providers/*.js (log security)
- src/aiservice/providers/*.js (API integration)
- src/queueing/providers/*.js (job processing)
```

## Security Headers to Verify

Check if responses include these headers:
```
- Content-Security-Policy
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security (HTTPS only)
- Referrer-Policy
```

## Common Vulnerabilities Found

### Vulnerability 1: Weak Password Hashing
**Pattern:** Using md5, sha1, or unsalted hashing
**Fix:** Use bcrypt, scrypt, or argon2 with salt

### Vulnerability 2: Hardcoded Credentials
**Pattern:** API keys in code or config files
**Fix:** Use environment variables only

### Vulnerability 3: Missing Authentication Check
**Pattern:** Public endpoints accessing sensitive data
**Fix:** Add auth middleware to sensitive routes

### Vulnerability 4: Path Traversal
**Pattern:** Direct use of user input in file paths
**Fix:** Validate and normalize paths

### Vulnerability 5: SQL/NoSQL Injection
**Pattern:** Concatenating user input into queries
**Fix:** Use parameterized queries or ORMs

### Vulnerability 6: Information Disclosure
**Pattern:** Error messages showing stack traces or internal details
**Fix:** Log details, return generic error to client

### Vulnerability 7: Broken Access Control
**Pattern:** No ownership checks on resources
**Fix:** Verify user owns/has permission for resource

### Vulnerability 8: Insecure Deserialization
**Pattern:** Using eval() or unsafe JSON parsing
**Fix:** Use JSON.parse() with strict validation

## Post-Audit Actions

After completing the audit:

1. **Document Findings**
   - List all vulnerabilities found
   - Rate by severity (Critical/High/Medium/Low)
   - Note remediation steps

2. **Create Issues**
   - Create GitHub/Jira issues for each finding
   - Link to relevant code sections
   - Assign priority and owner

3. **Remediate**
   - Fix critical vulnerabilities immediately
   - Schedule high-priority fixes
   - Track medium/low priority fixes

4. **Test Fixes**
   - Add tests to prevent regression
   - Verify fix solves the issue
   - Check for side effects

5. **Re-Audit**
   - Run audit again after fixes
   - Verify all issues resolved
   - Update security documentation

## Security Audit Report Template

```markdown
# Security Audit Report - [DATE]

## Executive Summary
- Total vulnerabilities found: X
- Critical: X | High: X | Medium: X | Low: X
- Audit coverage: X%

## Critical Issues
1. [Issue Name]
   - Location: [File/Function]
   - Risk: [Impact]
   - Recommendation: [Fix]

2. [Issue Name]
   - Location: [File/Function]
   - Risk: [Impact]
   - Recommendation: [Fix]

## High Priority Issues
[Similar format]

## Medium Priority Issues
[Similar format]

## Recommendations
1. [General recommendation]
2. [Process improvement]
3. [Tool/dependency update]

## Testing Results
- Authentication: PASS/FAIL
- Input Validation: PASS/FAIL
- API Security: PASS/FAIL
- File Operations: PASS/FAIL
- Rate Limiting: PASS/FAIL

## Next Steps
1. [Action item]
2. [Timeline]
3. [Owner]
```

## Continuous Security

### Pre-Commit Hook
```bash
# .git/hooks/pre-commit
npm audit --audit-level=moderate
```

### CI/CD Integration
```
- Run npm audit in CI pipeline
- Fail build if vulnerabilities found
- Generate security report for each build
- Track vulnerability trends
```

### Regular Reviews
- Monthly: Run audit and review findings
- Quarterly: Comprehensive code review
- Yearly: Third-party penetration test

## Security Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express.js Security Handbook](https://expressjs.com/en/advanced/best-practice-security.html)
- [NPM Security Documentation](https://docs.npmjs.com/cli/v7/commands/npm-audit)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)

## When to Run This Audit

- [ ] Before deploying to production
- [ ] Before releasing new version
- [ ] After major dependency updates
- [ ] After adding new services
- [ ] After changing authentication
- [ ] Monthly (routine check)
- [ ] When security advisories released
- [ ] Before onboarding new developers

## Related Commands

- `/help` - Get help with Claude Code
- `/init` - Analyze codebase
- `/update-docs` - Update documentation

## Audit Checklist Summary

```
Security Audit Progress:
- [ ] Secrets check
- [ ] Authentication review
- [ ] Input validation check
- [ ] API security review
- [ ] Dependency audit
- [ ] File operations check
- [ ] Data protection review
- [ ] Configuration review
- [ ] Logging review
- [ ] Third-party integrations review
- [ ] Automated checks
- [ ] Security header verification
- [ ] Testing scenarios
- [ ] Report generation
- [ ] Issues creation
- [ ] Remediation planning
```

Last Audit: [DATE]
Next Audit Scheduled: [DATE]
Auditor: [NAME/CLAUDE]
