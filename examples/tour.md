# markdrip tour

This document exercises every construct the renderer supports, in one
stream-friendly file.

Inline styles: **bold**, *italic*, ~~strikethrough~~, `inline code`,
a [link](https://example.test/docs) and an autolink <https://example.test/>.

## Lists

- unordered items
- with a second entry
  - and a nested level
- [x] a finished task
- [ ] an open task

1. ordered items
2. keep their numbers

## Quotes and code

> A blockquote that wraps across lines and carries **inline styles**
> through the bar.

```python
def greet(name):
    return f"hello, {name}"
```

## Tables

| stage   | latency | verdict |
|:--------|--------:|:-------:|
| parse   |   0.2ms |   ok    |
| repair  |   0.1ms |   ok    |
| render  |   0.4ms |   ok    |

---

Hard breaks too:  
line one  
line two
