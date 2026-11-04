/** Unit tests: VIN decode + plate lookup XML parsing (no DB). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeVin, vinYearMismatch } from '../src/lib/vin.js';
import { parseRegCheckXml } from '../src/lib/plateLookup.js';

test('VIN: valid 17-char VIN decodes model year from position 10', () => {
  const r = decodeVin('JTNBF3EK1J3001234', 2026);
  assert.equal(r.valid, true);
  assert.equal(r.year, 2018);
  assert.match(r.note, /2018/);
  assert.equal(decodeVin('jtnb f3ek-1j3001234', 2026).year, 2018, 'lowercase, spaces and dashes are normalised');
});

test('VIN: 30-year cycle picks the most recent year not after next year', () => {
  const at = (code: string, now: number) => decodeVin(`JTNBF3EK1${code}3001234`, now).year;
  assert.equal(at('A', 2026), 2010);
  assert.equal(at('L', 2026), 2020);
  assert.equal(at('T', 2026), 2026);
  assert.equal(at('V', 2026), 2027, 'next year is allowed (new models)');
  assert.equal(at('W', 2026), 1998, '2028 is too far ahead → 1998');
  assert.equal(at('Y', 2029), 2030);
  assert.equal(at('1', 2026), 2001);
  assert.equal(at('9', 2026), 2009);
  assert.equal(at('9', 2038), 2039);
});

test('VIN: invalid VINs are rejected; unknown year code is valid with no year', () => {
  assert.equal(decodeVin('JTNBF3EK1J300123', 2026).valid, false, '16 chars');
  assert.equal(decodeVin('JTNBF3EK1J30012345', 2026).valid, false, '18 chars');
  const o = decodeVin('JTNBF3EO1J3001234', 2026);
  assert.equal(o.valid, false);
  assert.match(o.note, /I, O or Q/);
  assert.equal(decodeVin('JTNBF3EK1J30012#4', 2026).valid, false);
  assert.equal(decodeVin('', 2026).valid, false);
  assert.equal(decodeVin(null, 2026).valid, false);
  const z = decodeVin('JTNBF3EK1Z3001234', 2026);
  assert.equal(z.valid, true);
  assert.equal(z.year, null);
  assert.equal(decodeVin('JTNBF3EK103001234', 2026).year, null, '0 is not a year code');
});

test('VIN: year mismatch only when more than a year apart', () => {
  assert.equal(vinYearMismatch(2018, 2019), false);
  assert.equal(vinYearMismatch(2018, 2020), true);
  assert.equal(vinYearMismatch(null, 2020), false);
});

test('plate lookup: parses escaped <vehicleJson> defensively', () => {
  const json = JSON.stringify({ Description: 'TOYOTA CAMRY ASCENT', RegistrationYear: '2019', CarMake: { CurrentTextValue: 'TOYOTA' },
    CarModel: { CurrentTextValue: 'CAMRY' }, VechileIdentificationNumber: 'JTNBZ3HK9K3012345', Expiry: '2027-03-01' });
  const esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xml = `<?xml version="1.0" encoding="utf-8"?><Vehicle xmlns="http://regcheck.org.uk"><vehicleJson>${esc}</vehicleJson><vehicleData><Description>x</Description></vehicleData></Vehicle>`;
  const r = parseRegCheckXml(xml);
  assert.deepEqual({ year: r.year, make: r.make, model: r.model, vin: r.vin, description: r.description, expiry: r.expiry },
    { year: 2019, make: 'TOYOTA', model: 'CAMRY', vin: 'JTNBZ3HK9K3012345', description: 'TOYOTA CAMRY ASCENT', expiry: '2027-03-01' });
  assert.equal((r.raw as any).Description, 'TOYOTA CAMRY ASCENT');
  const sparse = parseRegCheckXml(`<Vehicle><vehicleJson>{"Description":"UNKNOWN"}</vehicleJson></Vehicle>`);
  assert.equal(sparse.year, null);
  assert.equal(sparse.make, null);
  assert.throws(() => parseRegCheckXml('<Vehicle></Vehicle>'), /did not return/);
  assert.throws(() => parseRegCheckXml('<Vehicle><vehicleJson>not json</vehicleJson></Vehicle>'), /could not read/);
});
