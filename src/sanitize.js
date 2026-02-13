export function removeUndefinedDeep(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(item => item === undefined ? null : removeUndefinedDeep(item));
  }

  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) {
        result[key] = removeUndefinedDeep(value[key]);
      }
    }
    return result;
  }

  return value;
}

export function findUndefinedPaths(obj, prefix = "") {
  const paths = [];

  if (obj === undefined) {
    return [prefix || "(root)"];
  }

  if (obj === null || typeof obj !== "object") {
    return paths;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (obj[i] === undefined) {
        paths.push(`${prefix}[${i}]`);
      } else if (typeof obj[i] === "object" && obj[i] !== null) {
        paths.push(...findUndefinedPaths(obj[i], `${prefix}[${i}]`));
      }
    }
    return paths;
  }

  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (obj[key] === undefined) {
      paths.push(path);
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      paths.push(...findUndefinedPaths(obj[key], path));
    }
  }

  return paths;
}
