import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// ── Aislamiento: la lib escribe en process.cwd()/landing/src/data/landings.
// El test redirige process.cwd() a un directorio temporal para no tocar el
// repo real.
import {
  createLanding,
  listLandings,
  readLanding,
  validateSlug,
  writeLanding,
} from './landing-pages';

const TMP = '/tmp/wacrm-landing-pages-test';
const DIR = join(TMP, 'landing', 'src', 'data', 'landings');

describe('landing-pages', () => {
  beforeEach(async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(TMP);
    await fs.mkdir(DIR, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TMP, { recursive: true, force: true });
  });

  describe('validateSlug', () => {
    it('acepta slugs válidos', () => {
      expect(validateSlug('home')).toBeNull();
      expect(validateSlug('fisioterapia-deportiva')).toBeNull();
      expect(validateSlug('thank-you-download')).toBeNull();
      expect(validateSlug('a1-b2-c3')).toBeNull();
    });

    it('rechaza mayúsculas, espacios y caracteres especiales', () => {
      expect(validateSlug('Home')).not.toBeNull();
      expect(validateSlug('mi página')).not.toBeNull();
      expect(validateSlug('fisio/deportiva')).not.toBeNull();
      expect(validateSlug('fisio_deportiva')).not.toBeNull();
      expect(validateSlug('')).not.toBeNull();
      expect(validateSlug('a'.repeat(65))).not.toBeNull();
    });
  });

  describe('CRUD', () => {
    it('crea, lee y lista una página', async () => {
      const page = await createLanding('fisio-deportiva', 'Fisioterapia deportiva', 'Desc');
      expect(page.slug).toBe('fisio-deportiva');
      expect(page.blocks).toHaveLength(1);
      expect(page.blocks[0].type).toBe('hero-centered');

      const read = await readLanding('fisio-deportiva');
      expect(read.title).toBe('Fisioterapia deportiva');
      expect(read.description).toBe('Desc');

      const list = await listLandings();
      expect(list).toEqual([{ slug: 'fisio-deportiva', title: 'Fisioterapia deportiva' }]);
    });

    it('guarda cambios (writeLanding sobrescribe)', async () => {
      await createLanding('home', 'Título viejo', '');
      await writeLanding({
        slug: 'home',
        title: 'Título nuevo',
        description: 'Meta nueva',
        blocks: [{ type: 'cta', data: { title: 'Empieza' } }],
      });

      const read = await readLanding('home');
      expect(read.title).toBe('Título nuevo');
      expect(read.blocks[0].type).toBe('cta');
    });

    it('no permite crear un slug duplicado', async () => {
      await createLanding('home', 'A', '');
      await expect(createLanding('home', 'B', '')).rejects.toThrow('Ya existe');
    });

    it('rechaza slugs inválidos en create/write', async () => {
      await expect(createLanding('Mi Página', 'A', '')).rejects.toThrow();
      await expect(
        writeLanding({ slug: 'mal slug', title: 'A', description: '', blocks: [] }),
      ).rejects.toThrow();
    });

    it('lista tolera un JSON roto (no tumba la lista)', async () => {
      await createLanding('ok', 'OK', '');
      await fs.writeFile(join(DIR, 'roto.json'), '{no es json', 'utf-8');
      const list = await listLandings();
      const slugs = list.map((p) => p.slug).sort();
      expect(slugs).toEqual(['ok', 'roto']);
    });
  });
});