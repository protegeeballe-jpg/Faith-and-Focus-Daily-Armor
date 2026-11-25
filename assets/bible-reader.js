export const BIBLE_DEFAULT_VERSION = 'english_web';
export const BIBLE_DEFAULT_STORAGE_KEY = 'faith_focus_bible_default_version';

export const BIBLE_VERSIONS = Object.freeze([
    { id: 'bishops_bible', name: 'Bishops Bible', lang: 'English', file: 'bishops_bible.json' },
    { id: 'english_akjv', name: 'American King James', lang: 'English', file: 'english_akjv.json' },
    { id: 'english_asv', name: 'American Standard (ASV)', lang: 'English', file: 'english_asv.json' },
    { id: 'english_bbe', name: 'Bible in Basic English', lang: 'English', file: 'english_bbe.json' },
    { id: 'english_erv', name: 'English Revised', lang: 'English', file: 'english_erv.json' },
    { id: 'english_gb', name: 'Geneva Bible', lang: 'English', file: 'english_gb.json' },
    { id: 'english_hnv', name: 'Hebrew Names Version', lang: 'English', file: 'english_hnv.json' },
    { id: 'english_mil', name: 'Millennium Bible', lang: 'English', file: 'english_mil.json' },
    { id: 'english_mstc', name: 'Tyndale Bible', lang: 'English', file: 'english_mstc.json' },
    { id: 'english_septuagint', name: 'Septuagint', lang: 'English', file: 'english_septuagint.json' },
    { id: 'english_web', name: 'World English Bible (WEB)', lang: 'English', file: 'english_web.json' },
    { id: 'english_wtt', name: 'Westminster Leningrad Codex', lang: 'Hebrew/English', file: 'english_wtt.json' },
    { id: 'english_ylt', name: 'Youngs Literal Translation', lang: 'English', file: 'english_ylt.json' },
    { id: 'kjv', name: 'King James Version (KJV)', lang: 'English', file: 'kjv.json' },

    { id: 'chinese_bpv', name: 'Chinese BPV', lang: 'Chinese', file: 'chinese_bpv.json' },
    { id: 'chinese_ov', name: 'Chinese OV', lang: 'Chinese', file: 'chinese_ov.json' },
    { id: 'chinese_ovs', name: 'Chinese OVS', lang: 'Chinese', file: 'chinese_ovs.json' },

    { id: 'fil_ceb', name: 'Cebuano Bible', lang: 'Cebuano', file: 'fil_ceb.json' },
    { id: 'fil_cebpv', name: 'Cebuano BPV', lang: 'Cebuano', file: 'fil_cebpv.json' },
    { id: 'fil_cebv', name: 'Cebuano V', lang: 'Cebuano', file: 'fil_cebv.json' },
    { id: 'filipino_1905', name: 'Filipino 1905', lang: 'Filipino', file: 'filipino_1905.json' },
    { id: 'filipino_adb', name: 'Ang Dating Biblia (ADB)', lang: 'Filipino', file: 'filipino_adb.json' },
    { id: 'filipino_bicol', name: 'Bicolano Bible', lang: 'Bicolano', file: 'filipino_bicol.json' },
    { id: 'filipino_mb', name: 'Magandang Balita Biblia', lang: 'Filipino', file: 'filipino_mb.json' },
    { id: 'hiligaynon', name: 'Hiligaynon Bible', lang: 'Hiligaynon', file: 'hiligaynon.json' },
    { id: 'ilocano', name: 'Ilocano Bible', lang: 'Ilocano', file: 'ilocano.json' },
    { id: 'pampango', name: 'Pampango Bible', lang: 'Pampango', file: 'pampango.json' },
    { id: 'pangasinense', name: 'Pangasinense Bible', lang: 'Pangasinense', file: 'pangasinense.json' },
    { id: 'waray', name: 'Waray Bible', lang: 'Waray', file: 'waray.json' },

    { id: 'dutch', name: 'Dutch Bible', lang: 'Dutch', file: 'dutch.json' },
    { id: 'french', name: 'French Bible', lang: 'French', file: 'french.json' },
    { id: 'french_darby', name: 'French Darby', lang: 'French', file: 'french_darby.json' },
    { id: 'french_martin', name: 'French Martin', lang: 'French', file: 'french_martin.json' },
    { id: 'german_elberfelder', name: 'German Elberfelder', lang: 'German', file: 'german_elberfelder.json' },
    { id: 'german_luther', name: 'German Luther', lang: 'German', file: 'german_luther.json' },
    { id: 'greek', name: 'Greek Bible', lang: 'Greek', file: 'greek.json' },
    { id: 'greek_eberhard', name: 'Greek Eberhard', lang: 'Greek', file: 'greek_eberhard.json' },
    { id: 'haitian_creole', name: 'Haitian Creole', lang: 'Haitian Creole', file: 'haitian_creole.json' },
    { id: 'italian_gd', name: 'Italian Diodati', lang: 'Italian', file: 'italian_gd.json' },
    { id: 'latin_dr', name: 'Latin Douay-Rheims', lang: 'Latin', file: 'latin_dr.json' },
    { id: 'latin_vulgate', name: 'Latin Vulgate', lang: 'Latin', file: 'latin_vulgate.json' },
    { id: 'norwegian', name: 'Norwegian Bible', lang: 'Norwegian', file: 'norwegian.json' },
    { id: 'portuguese', name: 'Portuguese Bible', lang: 'Portuguese', file: 'portuguese.json' },
    { id: 'spanish_ba', name: 'Spanish Reina Valera', lang: 'Spanish', file: 'spanish_ba.json' },
    { id: 'spanish_vm', name: 'Spanish Versión Moderna', lang: 'Spanish', file: 'spanish_vm.json' },
    { id: 'swedish', name: 'Swedish Bible', lang: 'Swedish', file: 'swedish.json' }
].map(version => Object.freeze(version)));

const VALID_TASK_IDS = new Set(['bible-morning', 'bible-evening']);

function getBookName(record) {
    if (typeof record?.book === 'string' && record.book.trim()) return record.book.trim();
    if (typeof record?.book_name === 'string' && record.book_name.trim()) return record.book_name.trim();
    return '';
}

/**
 * Accept the two data shapes already used by the Bible collection:
 * a flat verse array, or a wrapper containing a verses array.
 * Verse wording is copied without edits or fallback substitution.
 */
export function normalizeBibleRecords(payload) {
    const source = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray(payload.verses)
            ? payload.verses
            : null;

    if (!source) {
        throw new TypeError('Unsupported Bible data. Expected a verse array or an object containing a verses array.');
    }

    const records = [];
    for (const record of source) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) continue;

        const book = getBookName(record);
        const chapter = Number(record.chapter);
        const verse = Number(record.verse);

        if (!book || !Number.isSafeInteger(chapter) || chapter < 1
            || !Number.isSafeInteger(verse) || verse < 1
            || typeof record.text !== 'string') {
            continue;
        }

        records.push(typeof record.book === 'string' && record.book.trim()
            ? record
            : { ...record, book });
    }

    if (records.length === 0) {
        throw new TypeError('Bible data does not contain recognizable book, chapter, verse, and text records.');
    }

    return records;
}

/**
 * Build a single-translation navigation index. Verse text stays verbatim.
 * The caller owns this index and should release it when the reader closes.
 */
export function buildBibleIndex(records) {
    if (!Array.isArray(records)) {
        throw new TypeError('Bible records must be an array.');
    }

    const books = new Map();

    for (const record of records) {
        const bookName = getBookName(record);
        const chapterNumber = Number(record?.chapter);
        const verseNumber = Number(record?.verse);

        if (!bookName || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1
            || !Number.isSafeInteger(verseNumber) || verseNumber < 1
            || typeof record?.text !== 'string') {
            continue;
        }

        const bookKey = bookName.toLocaleUpperCase();
        let book = books.get(bookKey);
        if (!book) {
            book = { name: bookName, chapters: new Map() };
            books.set(bookKey, book);
        }

        let chapter = book.chapters.get(chapterNumber);
        if (!chapter) {
            chapter = [];
            book.chapters.set(chapterNumber, chapter);
        }

        chapter.push(record);
    }

    for (const book of books.values()) {
        for (const verses of book.chapters.values()) {
            verses.sort((left, right) => Number(left.verse) - Number(right.verse));
        }
    }

    return {
        books,
        bookNames: Array.from(books.values(), book => book.name)
    };
}

function safeStorageRead(storage, key) {
    try {
        const value = storage?.getItem(key);
        return BIBLE_VERSIONS.some(version => version.id === value) ? value : BIBLE_DEFAULT_VERSION;
    } catch {
        return BIBLE_DEFAULT_VERSION;
    }
}

function safeStorageWrite(storage, key, value) {
    try {
        storage?.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function replaceSelectOptions(select, options, placeholder) {
    select.replaceChildren();
    if (placeholder) {
        const option = select.ownerDocument.createElement('option');
        option.value = '';
        option.textContent = placeholder;
        select.append(option);
    }

    for (const item of options) {
        const option = select.ownerDocument.createElement('option');
        option.value = String(item.value);
        option.textContent = item.label;
        select.append(option);
    }
}

/**
 * Create the one shared Bible reader. No Bible JSON is requested until open()
 * is called. Only the currently selected translation remains in memory.
 */
export function createBibleReader({
    documentRef = globalThis.document,
    fetchImpl = globalThis.fetch,
    storage = globalThis.localStorage,
    onTaskComplete = () => {}
} = {}) {
    if (!documentRef || typeof fetchImpl !== 'function') {
        throw new TypeError('The Bible reader requires a document and a fetch function.');
    }

    const dialog = documentRef.getElementById('bible-reader-dialog');
    const versionSelect = documentRef.getElementById('bible-reader-version');
    const bookSelect = documentRef.getElementById('bible-reader-book');
    const chapterSelect = documentRef.getElementById('bible-reader-chapter');
    const verseSelect = documentRef.getElementById('bible-reader-verse');
    const status = documentRef.getElementById('bible-reader-status');
    const heading = documentRef.getElementById('bible-reading-heading');
    const passage = documentRef.getElementById('bible-reading-text');
    const completeButton = documentRef.getElementById('bible-reader-complete-btn');
    const closeButton = documentRef.getElementById('bible-reader-close');

    const required = [
        dialog, versionSelect, bookSelect, chapterSelect, verseSelect,
        status, heading, passage, completeButton, closeButton
    ];
    if (required.some(element => !element)) {
        throw new Error('The Bible reader interface is incomplete.');
    }

    const versionsById = new Map(BIBLE_VERSIONS.map(version => [version.id, version]));
    let currentTaskId = null;
    let activeVersionId = null;
    let activeIndex = null;
    let activeController = null;
    let loadSequence = 0;

    function setStatus(message, state = 'info') {
        status.textContent = message;
        status.dataset.state = state;
    }

    function clearPassage() {
        passage.replaceChildren();
        heading.textContent = 'Choose a passage to begin.';
        completeButton.disabled = true;
        replaceSelectOptions(bookSelect, [], 'Load a Bible version first');
        replaceSelectOptions(chapterSelect, [], 'Chapter');
        replaceSelectOptions(verseSelect, [], 'Verse');
    }

    function releaseTranslation() {
        loadSequence += 1;
        activeController?.abort();
        activeController = null;
        activeVersionId = null;
        activeIndex = null;
        clearPassage();
    }

    function populateVersionOptions() {
        versionSelect.replaceChildren();
        const groups = new Map();

        for (const version of BIBLE_VERSIONS) {
            let group = groups.get(version.lang);
            if (!group) {
                group = documentRef.createElement('optgroup');
                group.label = version.lang;
                groups.set(version.lang, group);
                versionSelect.append(group);
            }

            const option = documentRef.createElement('option');
            option.value = version.id;
            option.textContent = version.name;
            group.append(option);
        }
    }

    function getSelectedBookName() {
        return bookSelect.value || '';
    }

    function getSelectedChapter() {
        const value = Number(chapterSelect.value);
        return Number.isSafeInteger(value) && value > 0 ? value : 0;
    }

    function getSelectedVerse() {
        const value = Number(verseSelect.value);
        return Number.isSafeInteger(value) && value > 0 ? value : 0;
    }

    function highlightSelectedVerse({ scroll = false } = {}) {
        const selectedVerse = getSelectedVerse();
        passage.querySelectorAll('[data-verse-number]').forEach(element => {
            const selected = Number(element.dataset.verseNumber) === selectedVerse;
            element.classList.toggle('is-selected', selected);
            if (selected && scroll) {
                element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            }
        });
    }

    function renderChapter({ scrollToVerse = false } = {}) {
        if (!activeIndex) return;

        const bookKey = getSelectedBookName().toLocaleUpperCase();
        const book = activeIndex.books.get(bookKey);
        const chapterNumber = getSelectedChapter();
        const verses = book?.chapters.get(chapterNumber) || [];

        passage.replaceChildren();
        if (!verses.length) {
            heading.textContent = 'Passage unavailable';
            setStatus('This book and chapter are not available in the selected translation.', 'error');
            completeButton.disabled = true;
            return;
        }

        const version = versionsById.get(activeVersionId);
        heading.textContent = book.name + ' ' + chapterNumber
            + (version ? ' · ' + version.name : '');

        const fragment = documentRef.createDocumentFragment();
        for (const verse of verses) {
            const paragraph = documentRef.createElement('p');
            paragraph.className = 'bible-reader-verse';
            paragraph.dataset.verseNumber = String(verse.verse);

            const number = documentRef.createElement('strong');
            number.className = 'bible-reader-verse-number';
            number.textContent = String(verse.verse) + ' ';

            const text = documentRef.createElement('span');
            text.textContent = verse.text;

            paragraph.append(number, text);
            fragment.append(paragraph);
        }
        passage.append(fragment);
        completeButton.disabled = false;
        setStatus(verses.length + ' verses loaded. Choose a verse to bring it into focus.');
        highlightSelectedVerse({ scroll: scrollToVerse });
    }

    function populateChapterOptions(bookName, preferredChapter = 1, preferredVerse = 1) {
        const book = activeIndex?.books.get(bookName.toLocaleUpperCase());
        const chapters = book
            ? Array.from(book.chapters.keys()).sort((left, right) => left - right)
            : [];

        replaceSelectOptions(
            chapterSelect,
            chapters.map(chapter => ({ value: chapter, label: 'Chapter ' + chapter })),
            'Chapter'
        );

        const chosenChapter = chapters.includes(Number(preferredChapter))
            ? Number(preferredChapter)
            : chapters[0];

        if (!chosenChapter) {
            replaceSelectOptions(verseSelect, [], 'Verse');
            completeButton.disabled = true;
            return;
        }

        chapterSelect.value = String(chosenChapter);
        populateVerseOptions(bookName, chosenChapter, preferredVerse);
    }

    function populateVerseOptions(bookName, chapterNumber, preferredVerse = 1) {
        const book = activeIndex?.books.get(bookName.toLocaleUpperCase());
        const verses = book?.chapters.get(Number(chapterNumber)) || [];
        replaceSelectOptions(
            verseSelect,
            verses.map(verse => ({ value: Number(verse.verse), label: 'Verse ' + verse.verse })),
            'Verse'
        );

        const chosenVerse = verses.some(verse => Number(verse.verse) === Number(preferredVerse))
            ? Number(preferredVerse)
            : Number(verses[0]?.verse);

        if (chosenVerse) verseSelect.value = String(chosenVerse);
        renderChapter();
    }

    function populateBooks(preferredBook = '', preferredChapter = 1, preferredVerse = 1) {
        const bookNames = activeIndex?.bookNames || [];
        replaceSelectOptions(
            bookSelect,
            bookNames.map(name => ({ value: name, label: name })),
            'Book'
        );

        const match = bookNames.find(name => name.toLocaleUpperCase() === preferredBook.toLocaleUpperCase());
        const chosenBook = match || bookNames[0] || '';
        if (!chosenBook) {
            replaceSelectOptions(chapterSelect, [], 'Chapter');
            replaceSelectOptions(verseSelect, [], 'Verse');
            completeButton.disabled = true;
            setStatus('This translation does not contain a readable book list.', 'error');
            return;
        }

        bookSelect.value = chosenBook;
        populateChapterOptions(chosenBook, preferredChapter, preferredVerse);
    }

    async function loadVersion(versionId, {
        preferredBook = '',
        preferredChapter = 1,
        preferredVerse = 1
    } = {}) {
        const version = versionsById.get(versionId);
        if (!version) {
            setStatus('Please choose an available Bible version.', 'error');
            return;
        }

        releaseTranslation();
        const sequence = loadSequence;
        const controller = new AbortController();
        activeController = controller;
        activeVersionId = versionId;
        completeButton.disabled = true;
        setStatus('Loading ' + version.name + '…');

        try {
            const url = new URL('../bible/' + version.file, import.meta.url);
            const response = await fetchImpl(url.href, {
                cache: 'no-store',
                signal: controller.signal
            });

            if (!response?.ok) {
                throw new Error('The Bible file could not be retrieved (HTTP ' + (response?.status ?? 'unknown') + ').');
            }

            const payload = await response.json();
            const records = normalizeBibleRecords(payload);
            if (sequence !== loadSequence || !dialog.open) return;

            activeIndex = buildBibleIndex(records);
            if (activeIndex.bookNames.length === 0) {
                throw new Error('No readable books were found in this Bible version.');
            }

            activeController = null;
            populateBooks(preferredBook, preferredChapter, preferredVerse);
        } catch (error) {
            if (controller.signal.aborted || sequence !== loadSequence) return;
            activeController = null;
                activeIndex = null;
            clearPassage();
            setStatus((error?.message || 'The Bible version could not be loaded.') + ' Close and reopen Read & Reflect to try again.', 'error');
        }
    }

    function close() {
        if (dialog.open && typeof dialog.close === 'function') {
            dialog.close();
        } else {
            releaseTranslation();
            currentTaskId = null;
        }
    }

    async function open(taskId) {
        if (!VALID_TASK_IDS.has(taskId)) {
            throw new TypeError('Unknown Read & Reflect task.');
        }

        currentTaskId = taskId;
        const savedVersion = safeStorageRead(storage, BIBLE_DEFAULT_STORAGE_KEY);
        versionSelect.value = savedVersion;

        if (!dialog.open) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        }

        await loadVersion(savedVersion);
    }

    function handleVersionChange() {
        const versionId = versionsById.has(versionSelect.value)
            ? versionSelect.value
            : BIBLE_DEFAULT_VERSION;
        versionSelect.value = versionId;
        const selected = {
            book: getSelectedBookName(),
            chapter: getSelectedChapter() || 1,
            verse: getSelectedVerse() || 1
        };

        const saved = safeStorageWrite(storage, BIBLE_DEFAULT_STORAGE_KEY, versionId);
        setStatus(saved
            ? 'Your preferred Bible version has been saved on this device.'
            : 'This version is selected, but your browser could not save the default preference.');
        loadVersion(versionId, {
            preferredBook: selected.book,
            preferredChapter: selected.chapter,
            preferredVerse: selected.verse
        });
    }

    versionSelect.addEventListener('change', handleVersionChange);
    bookSelect.addEventListener('change', () => {
        if (!activeIndex) return;
        populateChapterOptions(getSelectedBookName(), 1, 1);
    });
    chapterSelect.addEventListener('change', () => {
        if (!activeIndex) return;
        populateVerseOptions(getSelectedBookName(), getSelectedChapter(), 1);
    });
    verseSelect.addEventListener('change', () => highlightSelectedVerse({ scroll: true }));
    closeButton.addEventListener('click', close);
    completeButton.addEventListener('click', () => {
        if (!activeIndex || !currentTaskId || completeButton.disabled) return;
        const taskId = currentTaskId;
        try {
            onTaskComplete(taskId);
        } catch (error) {
            setStatus('The checklist could not be updated. ' + (error?.message || ''), 'error');
            return;
        }
        close();
    });
    dialog.addEventListener('close', () => {
        releaseTranslation();
        currentTaskId = null;
    });

    populateVersionOptions();
    const initialVersion = safeStorageRead(storage, BIBLE_DEFAULT_STORAGE_KEY);
    versionSelect.value = initialVersion;
    clearPassage();
    setStatus('Your Bible will load when you open Read & Reflect.');

    return Object.freeze({
        open,
        close,
        release: releaseTranslation
    });
}
