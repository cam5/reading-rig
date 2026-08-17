/**
 * The seed library: public-domain books ingested once (scripts/seedLibrary.ts)
 * under a dedicated library account and granted to every user, existing and
 * future (see app/domain/work/grantSeedWorks.server.ts).
 *
 * Pinned by the sha256 of the downloaded .epub, not a GitHub ref — Standard
 * Ebooks' GitHub repos hold build *source* (XHTML under src/epub), not a
 * built epub, and publish no release artifacts; the distributable epub only
 * exists at the standardebooks.org URL below. A content hash is the only
 * stable pin available, and it happens to be exactly what parseEpub's
 * hashEdition folds into Work.id — so as long as the hash matches, re-running
 * the seed script is a pure no-op, and if Standard Ebooks ever revises an
 * edition, the mismatch fails the script loudly instead of silently granting
 * every new user a different edition than existing readers have.
 */
export type SeedBookSource = {
  slug: string;
  title: string;
  url: string;
  sha256: string;
};

// Tao Te Ching and Beyond Good and Evil were both requested alongside The
// Conquest of Bread, but neither ingests intact: parseEpub's
// findChapterSections (parseEpub.ts) treats one spine file as one Chapter,
// and explicitly drops every top-level <section epub:type="chapter"> past
// the first when a file holds more than one (parseEpub.ts:296-303). Both
// books put many such sections in a single file — all 81 chapters of the
// Tao Te Ching live in one tao-te-ching.xhtml, all ~296 aphorisms of Beyond
// Good and Evil live nine-to-a-file across part-1..9.xhtml — so today's
// ingest silently keeps only the first chapter/aphorism of each and drops
// the rest (confirmed via `npm run seed:library`: Tao Te Ching lands as 1
// chapter/3 paragraphs instead of 81 sections, Beyond Good and Evil as 9
// chapters/9 paragraphs instead of hundreds). Shipping either as-is to
// every new user's shelf would be shipping a near-empty book under a real
// title, so both are left out of SEED_LIBRARY until parseEpub handles
// multiple chapter-sections per file. Their pins (verified against the
// current standardebooks.org edition):
//   tao-te-ching: https://standardebooks.org/ebooks/laozi/tao-te-ching/james-legge/downloads/laozi_tao-te-ching_james-legge.epub?source=download
//     sha256 59a2b2a27629938b0f902e169204830d2691bd292bbdff11fead27aa7af903f7
//   beyond-good-and-evil: https://standardebooks.org/ebooks/friedrich-nietzsche/beyond-good-and-evil/helen-zimmern/downloads/friedrich-nietzsche_beyond-good-and-evil_helen-zimmern.epub?source=download
//     sha256 7b61766d8014715a5b909e2135bd756db4564ee9e879d2c9e6a35a3a38f0578e
//
// The Wealth of Nations was requested too, and ingests structurally (32
// chapters parse fine — no dropped chapter-sections), but its Standard
// Ebooks edition carries hundreds of scholarly endnotes and several data
// tables that parseEpub can't carry through: ~800 noterefs land with no
// matching endnote body (endnotes are collected per spine file, and the
// notes file's own noterefs/structure don't line up 1:1 with the body
// text's), and collectParagraphSources skips <table>/<div> as unrecognized
// block-level content (parseEpub.ts's paragraph collector only handles
// <p>/<blockquote>/list elements), dropping tables in three chapters
// outright. Confirmed via the same parse-and-count check used for the two
// exclusions above: 819 warnings total. That's editorial apparatus and
// data loss on the same scale as the two exclusions above, so it's left
// out rather than shipped missing most of its notes. Pin (verified against
// the current standardebooks.org edition):
//   the-wealth-of-nations: https://standardebooks.org/ebooks/adam-smith/the-wealth-of-nations/downloads/adam-smith_the-wealth-of-nations.epub?source=download
//     sha256 dde43fae8d38009ee7ed107702c0abb0ddf620eaa668e14dcfa97d247d55aa06
export const SEED_LIBRARY: SeedBookSource[] = [
  {
    slug: "conquest-of-bread",
    title: "The Conquest of Bread",
    url: "https://standardebooks.org/ebooks/peter-kropotkin/the-conquest-of-bread/chapman-and-hall/downloads/peter-kropotkin_the-conquest-of-bread_chapman-and-hall.epub?source=download",
    sha256: "186bba472c59cb6375bc714e6d690d0dcfe1c5c4f9afaea7f2bb6408f463c908",
  },
  {
    slug: "crime-and-punishment",
    title: "Crime and Punishment",
    url: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/fyodor-dostoevsky_crime-and-punishment_constance-garnett.epub?source=download",
    sha256: "0b25f648cc4038050f179cbde8010c2c94912791310fac2ca4b57c83ebd00429",
  },
  {
    slug: "pride-and-prejudice",
    title: "Pride and Prejudice",
    url: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download",
    sha256: "9ec6e5cb33eb52e710bab5deeb283a174e222033cddb8aa84dbf186e6b9eceed",
  },
  {
    slug: "pragmatism",
    title: "Pragmatism",
    url: "https://standardebooks.org/ebooks/william-james/pragmatism/downloads/william-james_pragmatism.epub?source=download",
    sha256: "78db5b1768a2fa17977ca057ac94495dcad1820aa7ccdfb5211af824ebd66ded",
  },
  {
    slug: "consolation-of-philosophy",
    title: "The Consolation of Philosophy",
    url: "https://standardebooks.org/ebooks/boethius/the-consolation-of-philosophy/h-r-james/downloads/boethius_the-consolation-of-philosophy_h-r-james.epub?source=download",
    sha256: "2d496b0fc78ab000b6654a71f451c7b4e54aeca06895e6060704520c6ac1246a",
  },
];
