#!/usr/bin/env python3
"""Package a web app into a webxdc .xdc file."""

import argparse
import os
import zipfile
from pathlib import Path


def package_xdc(
    name: str,
    html_path: str,
    manifest_path: str,
    icon_path: str,
    output_path: str,
    extra_files: list = None,
) -> None:
    """Package files into a .xdc archive.

    Args:
        name: Base name for the .xdc file
        html_path: Path to index.html
        manifest_path: Path to manifest.toml
        icon_path: Path to icon file
        output_path: Output path for the .xdc file
        extra_files: List of additional files/directories to include
    """
    extra_files = extra_files or []

    # Ensure output directory exists
    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create the .xdc file (which is just a ZIP file)
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add required files
        zf.write(html_path, "index.html")
        zf.write(manifest_path, "manifest.toml")

        # Add icon if provided
        if icon_path and os.path.exists(icon_path):
            icon_name = os.path.basename(icon_path)
            zf.write(icon_path, icon_name)

        # Add extra files
        for extra in extra_files:
            if os.path.isdir(extra):
                # Add directory recursively
                for root, dirs, files in os.walk(extra):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, os.path.dirname(extra))
                        zf.write(file_path, arcname)
            elif os.path.isfile(extra):
                zf.write(extra, os.path.basename(extra))

    print(f"Created webxdc: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Package a web app into webxdc format")
    parser.add_argument("--name", required=True, help="App name")
    parser.add_argument("--html", required=True, help="Path to index.html")
    parser.add_argument("--manifest", required=True, help="Path to manifest.toml")
    parser.add_argument("--icon", help="Path to icon file")
    parser.add_argument("--output", required=True, help="Output .xdc file path")
    parser.add_argument(
        "--extra",
        action="append",
        default=[],
        help="Additional files/directories to include",
    )

    args = parser.parse_args()

    package_xdc(
        name=args.name,
        html_path=args.html,
        manifest_path=args.manifest,
        icon_path=args.icon,
        output_path=args.output,
        extra_files=args.extra,
    )


if __name__ == "__main__":
    main()
