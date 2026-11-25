import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {
    BIBLE_DEFAULT_VERSION,
    BIBLE_VERSIONS,
    normalizeBibleRecords,
    buildBibleIndex
} from '../assets/bible-reader.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');

test('the Bible catalogue represents every separate translation file exactly once', () => {
    const fileNames = readdirSync(new URL('../bible/', import.meta.url))
        .filter(fileName => fileName.endsWith('.json'))
        .sort();
    const catalogueFiles = BIBLE_VERSIONS.map(version => version.file).sort();

    assert.equal(BIBLE_VERSIONS.length, 46);
    assert.equal(new Set(BIBLE_VERSIONS.map(version => version.id)).size, 46);
    assert.equal(new Set(catalogueFiles).size, 46);
    assert.deepEqual(catalogueFiles, fileNames);
    assert.equal(BIBLE_DEFAULT_VERSION, 'english_web');
    assert.equal(BIBLE_VERSIONS.find(version => version.id === BIBLE_DEFAULT_VERSION)?.lang, 'English');
});

test('Bible records support the flat collection and the named-book wrapper without changing verse wording', () => {
    const flat = normalizeBibleRecords([
        {book: 'Genesis', chapter: '1', verse: '1', text: 'In the beginning.'}
    ]);
    assert.equal(flat[0].book, 'Genesis');
    assert.equal(flat[0].text, 'In the beginning.');

    const wrapped = normalizeBibleRecords({
        metadata: {translation: 'KJV'},
        verses: [
            {book: 1, book_name: 'Genesis', chapter: 1, verse: 1, text: 'In the beginning God created.'}
        ]
    });
    assert.equal(wrapped[0].book, 'Genesis');
    assert.equal(wrapped[0].text, 'In the beginning God created.');
    assert.throws(() => normalizeBibleRecords({metadata: {}, records: []}), /Unsupported Bible data/);
    assert.throws(() => normalizeBibleRecords([{book: 'Genesis', chapter: 0, verse: 1, text: 'Invalid'}]), /recognizable/);
});

test('Bible index keeps book order, sorts chapter verses, and preserves exact source text', () => {
    const records = normalizeBibleRecords([
        {book: 'Genesis', chapter: 1, verse: 2, text: 'Second verse  '},
        {book: 'Genesis', chapter: 1, verse: 1, text: 'First verse.'},
        {book: 'Genesis', chapter: 2, verse: 1, text: 'Chapter two.'},
        {book: 'Exodus', chapter: 1, verse: 1, text: 'Another book.'}
    ]);
    const index = buildBibleIndex(records);
    const genesis = index.books.get('GENESIS');

    assert.deepEqual(index.bookNames, ['Genesis', 'Exodus']);
    assert.deepEqual(Array.from(genesis.chapters.keys()), [1, 2]);
    assert.deepEqual(genesis.chapters.get(1).map(record => [
        Number(record.verse), record.text
    ]), [
        [1, 'First verse.'],
        [2, 'Second verse  ']
    ]);
    assert.equal(index.books.get('EXODUS').chapters.get(1)[0].text, 'Another book.');
    assert.throws(() => buildBibleIndex(null), /array/);
});

test('Card 2 starts and Card 5 ends with Read & Reflect, both using one reader dialog', () => {
    const card2Start = html.indexOf('id="card-step-2"');
    const card2End = html.indexOf('<!-- CARD 3 -->', card2Start);
    const card5Start = html.indexOf('id="card-step-5"');
    const card5End = html.indexOf('<!-- CARD 6 -->', card5Start);
    const card2 = html.slice(card2Start, card2End);
    const card5 = html.slice(card5Start, card5End);

    assert.ok(card2Start >= 0 && card2End > card2Start);
    assert.ok(card5Start >= 0 && card5End > card5Start);
    assert.ok(card2.indexOf('data-id="bible-morning"') < card2.indexOf('data-id="start-1"'));
    assert.ok(card5.indexOf('data-id="bible-evening"') > card5.indexOf('data-id="sleep-5"'));
    assert.equal((html.match(/id="bible-reader-dialog"/g) || []).length, 1);
    for (const id of [
        'bible-reader-version', 'bible-reader-book', 'bible-reader-chapter',
        'bible-reader-verse', 'bible-reader-status', 'bible-reader-complete-btn'
    ]) assert.ok(html.includes('id="' + id + '"'), 'Missing Bible reader control: ' + id);
    assert.match(html, /0 of 22 steps/);
    assert.match(html, /aria-valuemax="22"/);
});

test('Bible data is lazy, released on close, and excluded from service-worker caching', () => {
    assert.match(app, /createBibleReader\(/);
    assert.match(app, /bibleReader\?\.open\(id\)/);
    assert.match(worker, /\.\/assets\/bible-reader\.js/);
    assert.doesNotMatch(worker, /\.\/bible\/[^']+\.json/);
    assert.match(css, /\.bible-reader-dialog\s*\{/);
    assert.match(css, /\.bible-reader-verse\.is-selected\s*\{/);
    assert.match(css, /\.bible-reader-content\{[^}]*flex:1 1 auto[^}]*overflow:hidden/);
    assert.match(css, /\.bible-reader-passage-region\{[^}]*flex:1 1 0/);
    assert.match(css, /\.bible-reader-passage\{[^}]*flex:1 1 auto[^}]*max-height:none/);
    assert.doesNotMatch(html, /bible-reader-retry-btn/);
});
