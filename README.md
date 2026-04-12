# chardata
Char data NodeJS app

This is an app created using the Claude toolset in a couple of weeks, most of which was spent testing out
usability and iterating features.  The objectives of this development were:

1. Generate a tool useful for other ongoing investigation work at XYZ Lab Consulting.
2. Generate a tool which could be used freely by others in the color community, developers and end users alike.
3. Use AI toolsets to both quickly put together a rich set of features as well as assemble the push-to-cloud pipeline.
4. Create a tool whose computation and storage is largely local, to minimize cloud processing costs while still supporting many users.

The overall goal was to create a tool to manipulate characterization data sets for output devices, sourced from
physical measurements of synthetic targets.  I needed not only to visualize the data for many data sets, but also
to manipulate the data sets, primarily via subsetting and overall data massage (outlier removal, etc).

Over time, I will continue to add features.  Features currently in the backlog as of Apr 12, 2026 include:
1. Comparison/validation via ISO 12647-7.
2. Calculation of Murray-Davies density and related metrics (density-based TVI, colorimetric TVI, etc).
3. Validation via CTV.
4. Generation of gamut boundary visualization.

As a demonstration of the strengths and weaknesses of AI-based software development, this project is also going to spawn
a series of articles on https://colourbill.com
