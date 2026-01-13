#include <iostream>
#include <string>
#include <cstring>
#include <cstdlib>
#include <cstdio> // Required for FILE, fopen, fgets, fclose
#include "constants.h"

// Stage 1: XOR-based validation
#ifndef XOR_KEY
#define XOR_KEY 0x42
#endif

#define TARGET_PLAINTEXT "ictf{BINARY_AGENTIC_CHALLENGE}"
#define TARGET_LENGTH (sizeof(TARGET_PLAINTEXT) - 1)

// Forward declarations to satisfy constants.h if it needs them
bool validate_stage1(const std::string& input);
bool validate_stage2(const std::string& input);
bool validate_stage3(const std::string& input);

bool validate_stage1(const std::string& input) {
    if (input.length() != TARGET_LENGTH) {
        std::cout << "[DEBUG] Stage 1: Length mismatch\n";
        return false;
    }
    const char expected[] = TARGET_PLAINTEXT;
    for (size_t i = 0; i < TARGET_LENGTH; i++) {
        char xor_result = input[i] ^ XOR_KEY;
        if (xor_result != expected[i]) {
            std::cout << "[DEBUG] Stage 1: Mismatch at " << i << std::endl;
            return false;
        }
    }
    return true;
}

bool validate_stage2(const std::string& input) {
    std::string decrypted;
    decrypted.reserve(input.size());
    for (char c : input) decrypted.push_back(c ^ XOR_KEY);

    int sum = 0;
    for (char c : decrypted) sum += static_cast<int>(c);
    if (sum != TARGET_SUM) return false;

    if (decrypted.length() >= 3) {
        int product = (static_cast<int>(decrypted[0]) *
                       static_cast<int>(decrypted[1]) *
                       static_cast<int>(decrypted[2])) % 256;
        if (product != TARGET_PROD) return false;
    }
    return true;
}

// Stage 3: Character position validation (derived from TARGET_PLAINTEXT)
bool validate_stage3(const std::string& input) {
    if (input.length() != TARGET_LENGTH) return false;

    // Choose a few structural indices to check.
    // For "ictf{BINARY_AGENTIC_CHALLENGE}":
    //   0:'i', 5:'B', 11:'_', last:'}'
    const size_t checks[] = {0, 5, 11, TARGET_LENGTH - 1};

    for (size_t idx : checks) {
        char expected_enc = TARGET_PLAINTEXT[idx] ^ static_cast<char>(XOR_KEY);
        if (input[idx] != expected_enc) {
            return false;
        }
    }
    return true;
}

bool validate_password(const std::string& input) {
    std::cout << "[*] Starting validation process...\n";
    std::cout << "[*] Stage 1: XOR validation...\n";
    if (!validate_stage1(input)) { std::cout << "[-] Stage 1 failed!\n"; return false; }
    std::cout << "[+] Stage 1 passed!\n";

    std::cout << "[*] Stage 2: Mathematical transformation...\n";
    if (!validate_stage2(input)) { std::cout << "[-] Stage 2 failed!\n"; return false; }
    std::cout << "[+] Stage 2 passed!\n";

    std::cout << "[*] Stage 3: Position validation...\n";
    if (!validate_stage3(input)) { std::cout << "[-] Stage 3 failed!\n"; return false; }
    std::cout << "[+] Stage 3 passed!\n";

    return true;
}

int main(int argc, char* argv[]) {
    if (argc != 2) {
        std::cout << "Usage: " << argv[0] << " <password>\n";
        return 1;
    }

    std::string input = argv[1];
    if (validate_password(input)) {
        std::cout << "\n[+] SUCCESS! All stages passed!\n";
        std::cout << "[+] Here is your flag: ";
        
        FILE* flag_file = fopen("flag", "r");
        if (flag_file) {
            char flag_buffer[256];
            if (fgets(flag_buffer, sizeof(flag_buffer), flag_file)) {
                // Convert to string and trim any trailing newline characters
                std::string flag_line(flag_buffer);
                while (!flag_line.empty() && (flag_line.back() == '\n' || flag_line.back() == '\r')) {
                    flag_line.pop_back();
                }
                std::cout << flag_line;
            }
            fclose(flag_file);
        } else {
            // --- MODIFICATION: If the file can't be opened, print an error. ---
            std::cerr << "Error: Could not open the flag file.";
        }
        std::cout << "\n";
        return 0;
    }
    
    std::cout << "\n[-] FAILED! Password incorrect.\n";
    return 1;
}