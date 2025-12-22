#!/bin/bash
# Download and convert Nerd Fonts to WOFF2 for web hosting
# Requires: curl, unzip, woff2 (brew install woff2)

set -e

FONTS_DIR="$(dirname "$0")/../public/fonts"
TEMP_DIR=$(mktemp -d)
NERD_FONTS_VERSION="v3.3.0"
BASE_URL="https://github.com/ryanoasis/nerd-fonts/releases/download/${NERD_FONTS_VERSION}"

# Check for woff2_compress
if ! command -v woff2_compress &> /dev/null; then
    echo "Error: woff2_compress not found. Install with: brew install woff2"
    exit 1
fi

mkdir -p "$FONTS_DIR"

# Font mappings: zip_name -> output_prefix -> ttf_pattern
declare -A FONTS=(
    ["JetBrainsMono"]="JetBrainsMono:JetBrainsMonoNerdFontMono"
    ["FiraCode"]="FiraCode:FiraCodeNerdFontMono"
    ["Hack"]="Hack:HackNerdFontMono"
    ["Meslo"]="MesloLGS:MesloLGSNerdFontMono"
    ["CascadiaCode"]="CaskaydiaCove:CaskaydiaCoveNerdFontMono"
    ["SourceCodePro"]="SauceCodePro:SauceCodeProNerdFontMono"
    ["UbuntuMono"]="UbuntuMono:UbuntuMonoNerdFontMono"
    ["RobotoMono"]="RobotoMono:RobotoMonoNerdFontMono"
    ["Inconsolata"]="Inconsolata:InconsolataNerdFontMono"
    ["DejaVuSansMono"]="DejaVuSansMono:DejaVuSansMNerdFontMono"
    ["Mononoki"]="Mononoki:MononokiNerdFontMono"
    ["VictorMono"]="VictorMono:VictorMonoNerdFontMono"
    ["SpaceMono"]="SpaceMono:SpaceMonoNerdFontMono"
    ["Iosevka"]="Iosevka:IosevkaNerdFontMono"
    ["FiraMono"]="FiraMono:FiraMonoNerdFontMono"
    ["IBMPlexMono"]="BlexMono:BlexMonoNerdFontMono"
    ["Cousine"]="Cousine:CousineNerdFontMono"
    ["GeistMono"]="GeistMono:GeistMonoNerdFontMono"
    ["CommitMono"]="CommitMono:CommitMonoNerdFontMono"
    ["Monaspace"]="MonaspaceNeon:MonaspaceNeonNerdFontMono"
    ["ZedMono"]="ZedMono:ZedMonoNerdFontMono"
    ["0xProto"]="0xProto:0xProtoNerdFontMono"
)

download_and_convert() {
    local zip_name=$1
    local output_prefix=$2
    local ttf_pattern=$3

    echo "Processing $zip_name..."

    local zip_file="$TEMP_DIR/${zip_name}.zip"
    local extract_dir="$TEMP_DIR/${zip_name}"

    # Download
    if [ ! -f "$zip_file" ]; then
        echo "  Downloading ${zip_name}.zip..."
        curl -sL "${BASE_URL}/${zip_name}.zip" -o "$zip_file"
    fi

    # Extract
    mkdir -p "$extract_dir"
    unzip -qo "$zip_file" -d "$extract_dir"

    # Find and convert Regular and Bold TTF files
    for weight in "Regular" "Bold"; do
        # Find the TTF file (handles various directory structures)
        local ttf_file=$(find "$extract_dir" -name "*${ttf_pattern}-${weight}.ttf" -type f 2>/dev/null | head -1)

        if [ -n "$ttf_file" ] && [ -f "$ttf_file" ]; then
            local output_file="$FONTS_DIR/${output_prefix}-${weight}.woff2"
            echo "  Converting ${weight}..."
            woff2_compress "$ttf_file"
            local woff2_file="${ttf_file%.ttf}.woff2"
            if [ -f "$woff2_file" ]; then
                mv "$woff2_file" "$output_file"
                echo "  Created: $(basename "$output_file")"
            fi
        else
            echo "  Warning: ${weight} TTF not found for $zip_name"
        fi
    done
}

echo "Downloading and converting Nerd Fonts to WOFF2..."
echo "Output directory: $FONTS_DIR"
echo ""

for zip_name in "${!FONTS[@]}"; do
    IFS=':' read -r output_prefix ttf_pattern <<< "${FONTS[$zip_name]}"
    download_and_convert "$zip_name" "$output_prefix" "$ttf_pattern"
    echo ""
done

# Cleanup
rm -rf "$TEMP_DIR"

echo "Done! WOFF2 fonts are in: $FONTS_DIR"
echo ""
echo "Files created:"
ls -la "$FONTS_DIR"/*.woff2 2>/dev/null || echo "No WOFF2 files found"
