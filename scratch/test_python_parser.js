import { PythonParser } from '../dist/src/analyzer/pythonParser.js';

const parser = new PythonParser();
const code = `import json
import requests
from src.utils import helper`;

const result = parser.parseFile('main.py', code);
console.log('Result:', JSON.stringify(result, null, 2));
