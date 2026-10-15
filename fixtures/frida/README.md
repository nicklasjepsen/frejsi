# Fictional DTU CSV excerpt

Ten invented foods and nutritional values, with DTU's source column names after
projecting the Data_Table sheet and joining FoodGroup from the Food sheet. This is
a test fixture, not a source for the production dataset. Row 910 deliberately has
32.5 g available carbohydrate versus 48.5 g carbohydrate by difference and 16 g
fibre, so using the wrong column fails. Row 903 lacks available carbohydrate and
must be omitted; row 904 is zero and must be retained.

Production provenance and the precise CSV export procedure are in
`shared/src/food/frida/data/README.md`.
