// The Openings tab's layout (task 6.2, agreed with the user Nov 27): courses
// by side, then by what you face, and loading a course file.
import type { CourseTree } from '../coach/opening-tree';

export interface CatalogGroup {
  /** "1.e4", "Against 1.e4"… */
  title: string;
  /** A short note under the title, where the grouping needs explaining. */
  note?: string;
  /** Sub-groups in order: an optional label, then the course ids with the card's title. */
  rows: { label?: string; note?: string; courses: { id: string; title: string }[] }[];
}

export interface CatalogSide {
  title: string;
  groups: CatalogGroup[];
}

export const CATALOG: CatalogSide[] = [
  {
    title: 'Play as White',
    groups: [
      {
        title: '1.e4',
        rows: [
          { courses: [{ id: 'vienna-white', title: 'Vienna Gambit' }, { id: 'italian-white', title: 'Italian Game' }, { id: 'scotch-white', title: 'Scotch Game' }] },
          { label: 'When they reply', courses: [{ id: 'caro-kann-white', title: 'vs Caro-Kann' }, { id: 'scandinavian-white', title: 'vs Scandinavian' }] },
        ],
      },
      { title: '1.d4', rows: [{ courses: [{ id: 'london-white', title: 'London System' }, { id: 'queens-gambit-white', title: "Queen's Gambit" }] }] },
    ],
  },
  {
    title: 'Play as Black',
    groups: [
      {
        title: 'Against 1.e4',
        rows: [
          { courses: [{ id: 'caro-kann-black', title: 'Caro-Kann' }, { id: 'scandinavian-black', title: 'Scandinavian' }] },
          {
            label: 'Or 1…e5, and then',
            note: 'White picks the second move, so a 1…e5 player needs all three.',
            courses: [{ id: 'vienna-black', title: 'vs Vienna' }, { id: 'italian-black', title: 'vs Italian' }, { id: 'scotch-black', title: 'vs Scotch' }],
          },
        ],
      },
      { title: 'Against 1.d4', rows: [{ courses: [{ id: 'queens-gambit-black', title: "Queen's Gambit Declined" }, { id: 'london-black', title: 'vs London' }] }] },
    ],
  },
];

/** The card title of a course. */
export function courseTitle(id: string): string {
  for (const s of CATALOG) for (const g of s.groups) for (const r of g.rows) for (const c of r.courses) if (c.id === id) return c.title;
  return id;
}

/** What the tab needs before any course file is loaded (`public/openings/index.json`). */
export interface CourseSummary {
  id: string;
  opening: string;
  side: 'w' | 'b';
  role: 'play' | 'meet';
  defining: string[];
  startFen: string;
  /** Player moves (not the defining ones) per tier. */
  playerNodes: number[];
}

const base = () => import.meta.env.BASE_URL;

let index: Promise<Map<string, CourseSummary>> | undefined;
export function loadIndex(): Promise<Map<string, CourseSummary>> {
  index ??= fetch(`${base()}openings/index.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`index ${r.status}`);
      return r.json();
    })
    .then((j: { courses: CourseSummary[] }) => new Map(j.courses.map((c) => [c.id, c])))
    .catch((e) => {
      index = undefined;
      throw e;
    });
  return index;
}

const trees = new Map<string, Promise<CourseTree>>();
export function loadCourse(id: string): Promise<CourseTree> {
  if (!trees.has(id)) {
    trees.set(
      id,
      fetch(`${base()}openings/${id}.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`${id} ${r.status}`);
          return r.json() as Promise<CourseTree>;
        })
        .catch((e) => {
          trees.delete(id);
          throw e;
        }),
    );
  }
  return trees.get(id)!;
}
