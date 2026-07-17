"use strict";

function triggerInsertion(source) {
  const text = String(source || "");
  const shortcutDefinition = /^(?:async\s+)?def\s+shortcut\s*\(/m.exec(text);
  if (shortcutDefinition) {
    return {
      offset: shortcutDefinition.index,
      prefix: "",
      suffix: "\n",
    };
  }
  return {
    offset: text.length,
    prefix: text.length > 0 && !text.endsWith("\n") ? "\n" : "",
    suffix: "\n",
  };
}

function parameterTabStops(parameters, startIndex = 1) {
  const values = Array.isArray(parameters) ? parameters : [];
  const required = [];
  const optional = [];
  values.forEach((parameter, index) => {
    const defaultValue = parameter && parameter.defaultValue;
    if (defaultValue === undefined || defaultValue === null || defaultValue === "") {
      required.push(index);
    } else {
      optional.push(index);
    }
  });
  const stops = new Array(values.length);
  [...required, ...optional].forEach((parameterIndex, offset) => {
    stops[parameterIndex] = startIndex + offset;
  });
  return stops;
}

module.exports = {
  parameterTabStops,
  triggerInsertion,
};
