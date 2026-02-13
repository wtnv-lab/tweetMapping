#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "data", "czml", "tweets.json");
const outputRoot = path.join(repoRoot, "data", "czml", "tweet-tiles");
const tilesDir = path.join(outputRoot, "tiles");
const zoomLevel = 9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lonLatToTileXY(lon, lat, z) {
  const latClamped = clamp(lat, -85.05112878, 85.05112878);
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (latClamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return {
    x: clamp(x, 0, n - 1),
    y: clamp(y, 0, n - 1),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDirFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  const names = fs.readdirSync(dirPath);
  for (const name of names) {
    const targetPath = path.join(dirPath, name);
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      fs.unlinkSync(targetPath);
    }
  }
}

function main() {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const tweets = JSON.parse(raw);

  ensureDir(outputRoot);
  ensureDir(tilesDir);
  cleanDirFiles(tilesDir);

  const tileBuckets = new Map();
  const searchTweets = [];

  for (const tweet of tweets) {
    const coords = tweet && tweet.position && tweet.position.cartographicDegrees;
    if (!Array.isArray(coords) || coords.length < 2) {
      continue;
    }

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue;
    }

    const tile = lonLatToTileXY(lon, lat, zoomLevel);
    const key = `${zoomLevel}/${tile.x}/${tile.y}`;
    const target = tileBuckets.get(key);

    const compactTweet = {
      id: String(tweet.id),
      text: String(tweet.text || ""),
      lon: lon,
      lat: lat,
      img: tweet && tweet.billboard && tweet.billboard.image ? String(tweet.billboard.image) : "twitter.png",
    };
    searchTweets.push({
      id: compactTweet.id,
      text: compactTweet.text,
      tile: key,
    });

    if (target) {
      target.push(compactTweet);
    } else {
      tileBuckets.set(key, [compactTweet]);
    }
  }

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    zoom: zoomLevel,
    totalTweets: tweets.length,
    tiles: {},
  };

  for (const [tileKey, items] of tileBuckets.entries()) {
    const relativePath = `tiles/${tileKey.replace(/\//g, "_")}.json`;
    const outputPath = path.join(outputRoot, relativePath);

    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        version: 1,
        tile: tileKey,
        count: items.length,
        tweets: items,
      })
    );

    index.tiles[tileKey] = {
      path: relativePath,
      count: items.length,
    };
  }

  fs.writeFileSync(path.join(outputRoot, "index.json"), JSON.stringify(index));
  fs.writeFileSync(
    path.join(outputRoot, "search.json"),
    JSON.stringify({
      version: 1,
      generatedAt: index.generatedAt,
      totalTweets: searchTweets.length,
      tweets: searchTweets,
    })
  );

  const tileCount = Object.keys(index.tiles).length;
  console.log(`Generated ${tileCount} tiles for ${tweets.length} tweets at z=${zoomLevel}`);
}

main();
