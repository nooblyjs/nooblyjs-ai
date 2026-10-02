export const summary = (values) => ({ items: values.length, total: values.reduce((a, b) => a + b, 0) });
