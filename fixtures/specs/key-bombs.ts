export const ENUMERABLE_KEY_BOMB_SIZE = 250_000;

export function createEnumerableObjectKeyBomb(): Record<string, unknown> {
  const value = Object.create(null) as Record<string, unknown>;
  for (let index = 0; index < ENUMERABLE_KEY_BOMB_SIZE; index += 1) {
    value[`extra${index}`] = 0;
  }
  return value;
}

export function createEnumerableArrayExtraKeyBomb(): unknown[] & Record<string, unknown> {
  const value = [] as unknown as unknown[] & Record<string, unknown>;
  for (let index = 0; index < ENUMERABLE_KEY_BOMB_SIZE; index += 1) {
    value[`extra${index}`] = 0;
  }
  return value;
}
