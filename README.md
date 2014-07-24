asp-gv
======

A script for visualizing changing edge sets of graphs/networks

See the [github pages for demos and docs](http://vukk.github.io/asp-gv).

Why?
----

Visualizing change in edgesets of a graph is not trivial.
- the full graph might be large
- when nodes have static positions the visualization is hard to read
- transitions should be smooth, so they are easier to follow

A full graph:
![](screenshots/aspgv-tsppoc-whole.png?raw=true)

A graph with node positions fixed, original layout is with graphviz neato:
![](screenshots/aspgv-tsppoc-fixed1.png?raw=true)

Instead, we use force directed layouts:
![](screenshots/aspgv-tsp1-fullscreen?raw=true)
