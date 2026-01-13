#!/bin/bash
set -e

echo "[*] Building Binary Challenge with Printable Password..."

# Printable ASCII range
MIN=33
MAX=126
TARGET="ictf{BINARY_AGENTIC_CHALLENGE}"

# Helper: check if a single char is printable
function is_printable() {
    local ch="$1"
    local ord
    ord=$(printf "%d" "'$ch")
    [[ $ord -ge $MIN && $ord -le $MAX ]]
}

# --- choose XOR key that keeps all encoded chars printable ---
while true; do
    XOR_KEY=$((RANDOM % (MAX - MIN + 1) + MIN))
    printf "[*] Testing XOR key 0x%02X...\n" "$XOR_KEY"
    all_printable=true
    for ((i=0;i<${#TARGET};i++)); do
        c="${TARGET:$i:1}"
        enc_val=$(( $(printf "%d" "'$c") ^ XOR_KEY ))
        enc_char=$(printf "\\$(printf "%03o" "$enc_val")")
        if ! is_printable "$enc_char"; then
            all_printable=false
            break
        fi
    done
    $all_printable && {
        printf "[+] Found printable XOR key: 0x%02X\n" "$XOR_KEY"
        break
    }
done

printf "0x%02X\n" "$XOR_KEY" > xor_key.txt
echo "[+] XOR key saved to xor_key.txt"

# --- compute constants for Stage 2 ---
SUM=$(printf '%s' "$TARGET" | od -An -t u1 | awk '{for(i=1;i<=NF;i++)s+=$i}END{print s}')
A=$(printf "%d" "'${TARGET:0:1}'")
B=$(printf "%d" "'${TARGET:1:1}'")
C=$(printf "%d" "'${TARGET:2:1}'")
PROD=$(( (A * B * C) % 256 ))

cat > constants.h <<EOF
#ifndef CONSTANTS_H
#define CONSTANTS_H
#define TARGET_SUM $SUM
#define TARGET_PROD $PROD
#endif
EOF

echo "[+] constants.h generated: SUM=$SUM, PROD=$PROD"

# --- compile binary ---
echo "[*] Compiling challenge..."
g++ -DXOR_KEY="0x$(printf "%02X" "$XOR_KEY")" -o challenge challenge.cpp -g -O0
echo "[+] Binary compiled successfully"

# --- disassembly, etc. ---
# objdump -d challenge > challenge_disasm.txt
# objdump -t challenge > challenge_symbols.txt
# objdump -h challenge > challenge_sections.txt
# PYTHON generate_callgraph.py challenge 

python3 generate_callgraph.py challenge
# --- calculate encoded printable password ---
python3 - <<PY
xor_key = $XOR_KEY
target = "$TARGET"
encoded = ''.join(chr(ord(c) ^ xor_key) for c in target)
with open("correct_password.txt","w") as f: f.write(encoded)
print(f"[+] Correct password saved to correct_password.txt: {encoded}")
PY

echo
echo "[+] Build complete!"
echo "[+] Binary: ./challenge"
echo "[+] XOR Key: 0x$(printf "%02X" "$XOR_KEY")"
echo "[+] Correct password: $(cat correct_password.txt)"
