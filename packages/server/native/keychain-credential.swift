import Foundation
import Security

enum KeychainError: Error {
  case usage
  case status(OSStatus)
}

func run() throws -> Int32 {
  guard CommandLine.arguments.count == 4 else { throw KeychainError.usage }
  let action = CommandLine.arguments[1]
  let service = CommandLine.arguments[2]
  let account = CommandLine.arguments[3]
  let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
  ]

  if action == "get" {
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return 44 }
    guard status == errSecSuccess, let data = result as? Data,
          let value = String(data: data, encoding: .utf8) else { throw KeychainError.status(status) }
    FileHandle.standardOutput.write(Data(value.utf8))
    return 0
  }

  guard action == "set" || action == "rotate" else { throw KeychainError.usage }
  let secret = FileHandle.standardInput.readDataToEndOfFile()
  guard !secret.isEmpty else { throw KeychainError.usage }
  let add: [String: Any] = base.merging([
    kSecValueData as String: secret,
    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
  ]) { _, new in new }
  let status = SecItemAdd(add as CFDictionary, nil)
  if status == errSecDuplicateItem {
    guard action == "rotate" else { throw KeychainError.status(status) }
    let update = [kSecValueData as String: secret]
    let updateStatus = SecItemUpdate(base as CFDictionary, update as CFDictionary)
    guard updateStatus == errSecSuccess else { throw KeychainError.status(updateStatus) }
    return 0
  }
  guard status == errSecSuccess else { throw KeychainError.status(status) }
  return 0
}

do {
  exit(try run())
} catch {
  fputs("Keychain credential operation failed\n", stderr)
  exit(1)
}
