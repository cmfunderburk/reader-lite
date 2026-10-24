#!/bin/sh
# Render the home-screen icons from public/icon.svg (needs rsvg-convert, from
# librsvg). The PNGs are committed, so this only runs when the icon changes.
set -e
cd "$(dirname "$0")/../public"
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-icon.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
